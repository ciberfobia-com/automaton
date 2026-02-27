/**
 * Local Agent Worker
 *
 * Runs inference-driven task execution in-process as an async background task.
 * Each worker gets a role-specific system prompt, a subset of tools, and
 * runs a ReAct loop (think → tool_call → observe → repeat → done).
 *
 * This enables multi-agent orchestration on local machines without Conway
 * sandbox infrastructure. Workers share the same Node.js process but run
 * concurrently as independent async tasks.
 */

import { ulid } from "ulid";
import { exec as execCb } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createLogger } from "../observability/logger.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { completeTask, failTask } from "./task-graph.js";
import { claimAssignedTask } from "../state/database.js";
import type { TaskNode, TaskResult } from "./task-graph.js";
import type { Database } from "better-sqlite3";
import type { ConwayClient } from "../types.js";

function truncateOutput(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n[TRUNCATED: ${text.length - maxLen} chars omitted]`;
}

function localExec(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = execCb(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

async function localWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function localReadFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

const logger = createLogger("orchestration.local-worker");

const MAX_TURNS = 25;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const INFERENCE_TIMEOUT_MS = 60_000; // Per-call timeout for inference API
const INFERENCE_MAX_RETRIES = 1; // Retry once on inference failure

// Minimal inference interface — works with both UnifiedInferenceClient and
// an adapter around the main agent's InferenceClient.
interface WorkerInferenceClient {
  chat(params: {
    tier: string;
    messages: any[];
    tools?: any[];
    toolChoice?: string;
    maxTokens?: number;
    temperature?: number;
    responseFormat?: { type: string };
  }): Promise<{ content: string; toolCalls?: unknown[] }>;
}

interface LocalWorkerConfig {
  db: Database;
  inference: WorkerInferenceClient;
  conway: ConwayClient;
  workerId: string;
  maxTurns?: number;
}

interface WorkerToolResult {
  name: string;
  output: string;
  error?: string;
}

// Minimal tool set available to local workers
interface WorkerTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export class LocalWorkerPool {
  private activeWorkers = new Map<string, { promise: Promise<void>; taskId: string; abortController: AbortController }>();

  constructor(private readonly config: LocalWorkerConfig) { }

  /**
   * Spawn a local worker for a task. Returns immediately — the worker
   * runs in the background and reports results via the task graph.
   */
  spawn(task: TaskNode): { address: string; name: string; sandboxId: string } {
    const workerId = `local-worker-${ulid()}`;
    const workerName = `worker-${task.agentRole ?? "generalist"}-${workerId.slice(-6)}`;
    const address = `local://${workerId}`;
    const abortController = new AbortController();

    const workerPromise = this.runWorker(workerId, task, abortController.signal)
      .catch((error) => {
        logger.error("Local worker crashed", error instanceof Error ? error : new Error(String(error)), {
          workerId,
          taskId: task.id,
        });
        this.workerLog(workerId, task, `CRASHED: ${error instanceof Error ? error.message : String(error)}`);
        try {
          failTask(this.config.db, task.id, `Worker crashed: ${error instanceof Error ? error.message : String(error)}`, true);
        } catch { /* task may already be in terminal state */ }
        // Update child status to reflect failure
        this.updateWorkerChildStatus(address, "failed");
      })
      .finally(() => {
        this.activeWorkers.delete(workerId);
      });

    this.activeWorkers.set(workerId, { promise: workerPromise, taskId: task.id, abortController });

    return { address, name: workerName, sandboxId: workerId };
  }

  getActiveCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * Check if a worker is currently active in this pool.
   * Accepts either a full address ("local://worker-id") or raw worker ID.
   */
  hasWorker(addressOrId: string): boolean {
    const id = addressOrId.replace("local://", "");
    return this.activeWorkers.has(id);
  }

  async shutdown(): Promise<void> {
    for (const [, worker] of this.activeWorkers) {
      worker.abortController.abort();
    }
    await Promise.allSettled([...this.activeWorkers.values()].map((w) => w.promise));
    this.activeWorkers.clear();
  }

  private async runWorker(workerId: string, task: TaskNode, signal: AbortSignal): Promise<void> {
    const maxTurns = this.config.maxTurns ?? MAX_TURNS;
    const tools = this.buildWorkerTools();
    const toolDefs = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const systemPrompt = this.buildWorkerSystemPrompt(task);
    const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: this.buildTaskPrompt(task) },
    ];

    const artifacts: string[] = [];
    let finalOutput = "";
    const startedAt = Date.now();

    // ─── EARLY LOG: write to DB BEFORE anything else ────────────
    // This ensures dashboard visibility even if the process dies
    // during claimAssignedTask or the first inference call.
    const workerAddress = `local://${workerId}`;
    this.workerLog(workerId, task, `SPAWNED — about to claim task "${task.title}" (role: ${task.agentRole ?? "generalist"})`);
    logger.info(`[WORKER ${workerId}] Spawned for task "${task.title}" (${task.id})`);

    // ─── Yield to event loop ─────────────────────────────────────
    // Critical: runWorker() is async but runs synchronously until
    // the first await. Without this yield, claimAssignedTask() fires
    // BEFORE the orchestrator's assignTask() sets status='assigned',
    // causing the claim to always fail (task is still 'pending').
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // ─── Atomic Claim: assigned → running ────────────────────────
    // The orchestrator sets status='assigned' but the worker must
    // transition to 'running' (setting started_at) so the task is
    // visible as in-progress. Without this, assigned tasks stay
    // permanently stuck on restart (dispatch deadlock).
    const claimed = claimAssignedTask(this.config.db, task.id, workerAddress);
    if (!claimed) {
      logger.warn(`[WORKER ${workerId}] Could not claim task ${task.id} — already claimed or status changed, skipping`);
      this.workerLog(workerId, task, `CLAIM FAILED — task already claimed or status changed`);
      return;
    }

    this.workerLog(workerId, task, `CLAIMED — starting inference loop (maxTurns=${maxTurns})`);
    logger.info(`[WORKER ${workerId}] Claimed task "${task.title}" (${task.id}), role: ${task.agentRole ?? "generalist"}`);

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal.aborted) {
        logger.info(`[WORKER ${workerId}] Aborted on turn ${turn}`);
        this.workerLog(workerId, task, `ABORTED on turn ${turn}`);
        failTask(this.config.db, task.id, "Worker aborted", false);
        this.updateWorkerChildStatus(workerAddress, "stopped");
        return;
      }

      const timeoutMs = task.metadata.timeoutMs || DEFAULT_TIMEOUT_MS;
      if (Date.now() - startedAt > timeoutMs) {
        logger.warn(`[WORKER ${workerId}] Timed out after ${timeoutMs}ms on turn ${turn}`);
        this.workerLog(workerId, task, `TIMED OUT after ${timeoutMs}ms on turn ${turn}`);
        failTask(this.config.db, task.id, `Worker timed out after ${timeoutMs}ms`, true);
        this.updateWorkerChildStatus(workerAddress, "stopped");
        return;
      }

      logger.info(`[WORKER ${workerId}] Turn ${turn + 1}/${maxTurns} — calling inference (tier: fast)`);
      this.workerLog(workerId, task, `Turn ${turn + 1}/${maxTurns} — calling inference`);

      // Heartbeat: update last_checked every 3 turns so dashboard sees worker is alive
      if (turn % 3 === 0) {
        try {
          this.config.db.prepare(
            `UPDATE children SET last_checked = ? WHERE address = ?`,
          ).run(new Date().toISOString(), workerAddress);
        } catch { /* best-effort */ }
      }

      let response;
      let lastError: string | null = null;
      for (let attempt = 0; attempt <= INFERENCE_MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            logger.info(`[WORKER ${workerId}] Retrying inference (attempt ${attempt + 1})`);
            this.workerLog(workerId, task, `Retrying inference (attempt ${attempt + 1})`);
            await new Promise(r => setTimeout(r, 3000)); // wait 3s before retry
          }
          response = await this.chatWithTimeout({
            tier: "fast",
            messages: messages as any,
            tools: toolDefs,
            toolChoice: "auto",
          });
          lastError = null;
          break; // success
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          logger.warn(`[WORKER ${workerId}] Inference attempt ${attempt + 1} failed: ${lastError}`);
          this.workerLog(workerId, task, `INFERENCE attempt ${attempt + 1} failed: ${lastError}`);
        }
      }
      if (!response || lastError) {
        logger.error(`[WORKER ${workerId}] Inference failed on turn ${turn + 1} after ${INFERENCE_MAX_RETRIES + 1} attempts`, new Error(lastError ?? "unknown"));
        this.workerLog(workerId, task, `INFERENCE FAILED on turn ${turn + 1}: ${lastError}`);
        failTask(this.config.db, task.id, `Inference failed: ${lastError}`, true);
        this.updateWorkerChildStatus(workerAddress, "failed");
        return;
      }

      // Check if the model wants to call tools
      if (response.toolCalls && Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
        const toolNames = (response.toolCalls as any[]).map((tc: any) => tc.function?.name ?? "?").join(", ");
        logger.info(`[WORKER ${workerId}] Turn ${turn + 1} — tool calls: ${toolNames}`);
        this.workerLog(workerId, task, `Turn ${turn + 1}/${maxTurns} — tools: ${toolNames}`);

        // Add assistant message with tool calls
        messages.push({
          role: "assistant",
          content: response.content || "",
          tool_calls: response.toolCalls,
        });

        // Execute each tool call
        for (const rawToolCall of response.toolCalls) {
          const toolCall = rawToolCall as { id: string; function: { name: string; arguments: string | Record<string, unknown> } };
          const fn = toolCall.function;
          const tool = tools.find((t) => t.name === fn.name);

          let toolOutput: string;
          if (!tool) {
            toolOutput = `Error: Unknown tool '${fn.name}'`;
            logger.warn(`[WORKER ${workerId}] Unknown tool: ${fn.name}`);
          } else {
            try {
              const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
              toolOutput = await tool.execute(args as Record<string, unknown>);
              logger.info(`[WORKER ${workerId}] ${fn.name} → ${toolOutput.slice(0, 120)}`);
              this.workerLog(workerId, task, `  tool ${fn.name} → ${toolOutput.slice(0, 200)}`);

              // Track file artifacts
              if (fn.name === "write_file" && typeof (args as any).path === "string") {
                artifacts.push((args as any).path);
              }
            } catch (error) {
              toolOutput = `Error: ${error instanceof Error ? error.message : String(error)}`;
              this.workerLog(workerId, task, `  tool ${fn.name} ERROR: ${toolOutput.slice(0, 200)}`);
            }
          }

          messages.push({
            role: "tool",
            content: toolOutput,
            tool_call_id: toolCall.id,
          });
        }

        continue;
      }

      // No tool calls — the model is done (final response)
      finalOutput = response.content || "Task completed.";
      logger.info(`[WORKER ${workerId}] Done on turn ${turn + 1} — ${finalOutput.slice(0, 200)}`);
      this.workerLog(workerId, task, `DONE on turn ${turn + 1}: ${finalOutput.slice(0, 300)}`);
      break;
    }

    // Mark task as completed
    const duration = Date.now() - startedAt;
    const result: TaskResult = {
      success: true,
      output: finalOutput,
      artifacts,
      costCents: 0,
      duration,
    };

    try {
      completeTask(this.config.db, task.id, result);
      const turns = messages.filter((m) => m.role === "assistant").length;
      logger.info("Local worker completed task", {
        workerId,
        taskId: task.id,
        title: task.title,
        duration,
        turns,
      });
      this.workerLog(workerId, task, `COMPLETED in ${turns} turns (${Math.round(duration / 1000)}s)`);
      this.updateWorkerChildStatus(`local://${workerId}`, "stopped");
    } catch (error) {
      logger.warn("Failed to mark task complete", {
        workerId,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      this.updateWorkerChildStatus(`local://${workerId}`, "failed");
    }
  }

  /**
   * Persist a worker log entry to event_stream for dashboard visibility.
   * Uses type='worker_log' so the diagnostics snapshot can filter for them.
   */
  private workerLog(workerId: string, task: TaskNode, message: string): void {
    try {
      this.config.db.prepare(
        `INSERT INTO event_stream (id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at)
         VALUES (?, 'worker_log', ?, ?, ?, ?, 0, NULL, ?)`,
      ).run(ulid(), `local://${workerId}`, task.goalId, task.id, message, new Date().toISOString());
    } catch {
      // Never let log persistence crash the worker
    }
  }

  /**
   * Wrap inference.chat() with a timeout to prevent hung API calls from
   * freezing workers indefinitely.
   */
  private async chatWithTimeout(params: Parameters<WorkerInferenceClient["chat"]>[0]): Promise<{ content: string; toolCalls?: unknown[] }> {
    return new Promise<{ content: string; toolCalls?: unknown[] }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Inference call timed out after ${INFERENCE_TIMEOUT_MS}ms`)),
        INFERENCE_TIMEOUT_MS,
      );
      this.config.inference.chat(params)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }

  /**
   * Update the child record status in the DB when a worker finishes.
   * This ensures the dashboard reflects accurate worker state.
   */
  private updateWorkerChildStatus(address: string, status: "stopped" | "failed"): void {
    try {
      this.config.db.prepare(
        `UPDATE children SET status = ?, last_checked = ? WHERE address = ?`,
      ).run(status, new Date().toISOString(), address);
    } catch {
      // Best-effort — don't crash the worker for a status update
    }
  }

  private buildWorkerSystemPrompt(task: TaskNode): string {
    const role = task.agentRole ?? "generalist";
    return `You are a worker agent with the role: ${role}.

You have been assigned a specific task by the parent orchestrator. Your job is to
complete this task using the tools available to you and then provide your final output.

RULES:
- Focus ONLY on the assigned task. Do not deviate.
- Use exec to run shell commands (install packages, run scripts, etc.)
- Use write_file to create or modify files.
- Use read_file to inspect existing files.
- When done, provide a clear summary of what you accomplished as your final message.
- If you cannot complete the task, explain why in your final message.
- Do NOT call tools after you are done. Just give your final text response.
- Be efficient. Minimize unnecessary tool calls.
- You have a limited number of turns. Do not waste them.`;
  }

  private buildTaskPrompt(task: TaskNode): string {
    const lines = [
      `# Task Assignment`,
      `**Title:** ${task.title}`,
      `**Description:** ${task.description}`,
      `**Role:** ${task.agentRole ?? "generalist"}`,
      `**Task ID:** ${task.id}`,
      `**Goal ID:** ${task.goalId}`,
    ];

    if (task.dependencies.length > 0) {
      lines.push(`**Dependencies (completed):** ${task.dependencies.join(", ")}`);
    }

    lines.push("", "Complete this task and provide your results.");
    return lines.join("\n");
  }

  private buildWorkerTools(): WorkerTool[] {
    return [
      {
        name: "exec",
        description: "Execute a shell command and return stdout/stderr. Use for installing packages, running scripts, building code, etc.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The shell command to execute" },
            timeout_ms: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
          },
          required: ["command"],
        },
        execute: async (args) => {
          const command = args.command as string;
          const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 30_000;

          // Try Conway API first, fall back to local shell
          try {
            const result = await this.config.conway.exec(command, timeoutMs);
            const stdout = truncateOutput(result.stdout ?? "", 16_000);
            const stderr = truncateOutput(result.stderr ?? "", 4000);
            return stderr ? `stdout:\n${stdout}\nstderr:\n${stderr}` : stdout || "(no output)";
          } catch {
            try {
              const result = await localExec(command, timeoutMs);
              const stdout = truncateOutput(result.stdout, 16_000);
              const stderr = truncateOutput(result.stderr, 4000);
              return stderr ? `stdout:\n${stdout}\nstderr:\n${stderr}` : stdout || "(no output)";
            } catch (error) {
              return `exec error: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
        },
      },
      {
        name: "write_file",
        description: "Write content to a file. Creates parent directories if needed.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to write to" },
            content: { type: "string", description: "File content" },
          },
          required: ["path", "content"],
        },
        execute: async (args) => {
          const filePath = args.path as string;
          const content = args.content as string;

          try {
            await this.config.conway.writeFile(filePath, content);
            return `Wrote ${content.length} bytes to ${filePath}`;
          } catch {
            try {
              await localWriteFile(filePath, content);
              return `Wrote ${content.length} bytes to ${filePath} (local)`;
            } catch (error) {
              return `write error: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
        },
      },
      {
        name: "read_file",
        description: "Read the contents of a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
          },
          required: ["path"],
        },
        execute: async (args) => {
          try {
            const content = await this.config.conway.readFile(args.path as string);
            return content.slice(0, 10_000) || "(empty file)";
          } catch {
            try {
              const content = await localReadFile(args.path as string);
              return content.slice(0, 10_000) || "(empty file)";
            } catch (error) {
              return `read error: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
        },
      },
      {
        name: "task_done",
        description: "Signal that you have finished the task. Call this as your final action with a summary of what you accomplished.",
        parameters: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Summary of what was accomplished" },
          },
          required: ["summary"],
        },
        execute: async (args) => {
          return `TASK_COMPLETE: ${args.summary as string}`;
        },
      },
    ];
  }
}
