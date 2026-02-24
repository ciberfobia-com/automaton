/**
 * Database Wrapper
 *
 * Opens SQLite in readonly mode with graceful degradation
 * for missing databases or tables.
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const config = require("./config");

let db = null;

function open() {
    const dbPath = config.stateDbPath;

    if (!fs.existsSync(dbPath)) {
        console.warn(`[dashboard] Database not found at ${dbPath} — running in empty mode`);
        return null;
    }

    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        db.pragma("journal_mode = WAL");
        console.log(`[dashboard] Opened database: ${dbPath}`);
        return db;
    } catch (err) {
        console.error(`[dashboard] Failed to open database: ${err.message}`);
        return null;
    }
}

/**
 * Run a SELECT query, returning all rows. Returns [] on any error.
 */
function safeAll(sql, params = []) {
    if (!db) return [];
    try {
        return db.prepare(sql).all(...params);
    } catch (err) {
        // Table might not exist yet — degrade gracefully
        if (err.message && err.message.includes("no such table")) {
            return [];
        }
        console.error(`[dashboard] Query error: ${err.message}`);
        return [];
    }
}

/**
 * Run a SELECT query, returning a single row. Returns null on any error.
 */
function safeGet(sql, params = []) {
    if (!db) return null;
    try {
        return db.prepare(sql).get(...params) || null;
    } catch (err) {
        if (err.message && err.message.includes("no such table")) {
            return null;
        }
        console.error(`[dashboard] Query error: ${err.message}`);
        return null;
    }
}

/**
 * Check if a table exists in the database.
 */
function tableExists(tableName) {
    if (!db) return false;
    try {
        const row = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
            .get(tableName);
        return !!row;
    } catch {
        return false;
    }
}

/**
 * Returns true if the DB connection is alive.
 */
function isConnected() {
    return db !== null;
}

function getDb() {
    return db;
}

module.exports = { open, safeAll, safeGet, tableExists, isConnected, getDb };
