# CiberPadre — Guía de Operaciones

Guía completa para levantar, mantener y actualizar CiberPadre (runtime + dashboard) en un VPS Linux con `systemd`.


## DESPLEGAR CAMBIOS DEL TIRON

```bash
cd /opt/automaton
git pull
pnpm install
pnpm build
sudo bash scripts/install-services.sh
sudo systemctl restart ciberpadre ciberpadre-dashboard
```

## Prerrequisitos

```bash
# Node.js >= 20
node --version

# pnpm (gestor de paquetes)
npm install -g pnpm

# git
git --version
```

Si no tienes Node.js 20+:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 1. Setup Inicial (primera vez)

### 1.1 Clonar y build

```bash
cd /opt
git clone https://github.com/ciberfobia-com/automaton.git
cd automaton
pnpm install
pnpm build
```

### 1.2 Instalar dependencias del dashboard

```bash
cd /opt/automaton/apps/dashboard
npm install
cd /opt/automaton
```

### 1.3 Configurar el automaton (primera vez)

```bash
node dist/index.js --setup
```

Sigue el wizard interactivo para configurar API keys, wallet, etc.

### 1.4 Instalar servicios systemd

```bash
# Script automático (copia .service files + reload + enable)
sudo bash scripts/install-services.sh
```

### 1.5 Arrancar los servicios

```bash
sudo systemctl start ciberpadre
sudo systemctl start ciberpadre-dashboard
```

---

## 2. Ver Estado

```bash
# Estado de ambos servicios
sudo systemctl status ciberpadre ciberpadre-dashboard

# Solo ciberpadre
sudo systemctl status ciberpadre

# Solo dashboard
sudo systemctl status ciberpadre-dashboard
```

---

## 3. Ver Logs (sin detener el servicio)

Los logs se ven con `journalctl`. **Puedes cerrar la consola SSH sin detener nada.**

```bash
# Logs de CiberPadre (en vivo, Ctrl+C para salir SIN detener)
sudo journalctl -u ciberpadre -f

# Logs del Dashboard (en vivo)
sudo journalctl -u ciberpadre-dashboard -f

# Últimas 100 líneas de CiberPadre
sudo journalctl -u ciberpadre -n 100

# Logs de hoy
sudo journalctl -u ciberpadre --since today

# Logs de la última hora
sudo journalctl -u ciberpadre --since "1 hour ago"
```

> **IMPORTANTE**: `Ctrl+C` en `journalctl -f` solo cierra el visor de logs, NO detiene el servicio. Es totalmente seguro.

---

## 4. Parar / Reiniciar Servicios

```bash
# Parar CiberPadre (envía SIGTERM, limpia workers)
sudo systemctl stop ciberpadre

# Parar Dashboard
sudo systemctl stop ciberpadre-dashboard

# Reiniciar CiberPadre
sudo systemctl restart ciberpadre

# Reiniciar Dashboard
sudo systemctl restart ciberpadre-dashboard

# Parar TODO
sudo systemctl stop ciberpadre ciberpadre-dashboard
```

---

## 5. Actualizar Código

### 5.1 Actualizar TODO (runtime + dashboard)

```bash
# 1. Parar ambos servicios
sudo systemctl stop ciberpadre ciberpadre-dashboard

# 2. Traer los cambios
cd /opt/automaton
git pull

# 3. Reinstalar dependencias y rebuildar
pnpm install
pnpm build

# 4. Reinstalar deps del dashboard (por si cambiaron)
cd apps/dashboard && npm install && cd ../..

# 5. Reinstalar servicios systemd (por si cambiaron los .service)
sudo bash scripts/install-services.sh

# 6. Arrancar ambos
sudo systemctl start ciberpadre ciberpadre-dashboard

# 7. Verificar
sudo systemctl status ciberpadre ciberpadre-dashboard
```

### 5.2 Actualizar SOLO CiberPadre (runtime)

```bash
sudo systemctl stop ciberpadre
cd /opt/automaton
git pull
pnpm install
pnpm build
sudo systemctl start ciberpadre
```

### 5.3 Actualizar SOLO Dashboard

```bash
sudo systemctl stop ciberpadre-dashboard
cd /opt/automaton
git pull
cd apps/dashboard
npm install
cd ../..
sudo systemctl start ciberpadre-dashboard
```

> **NOTA**: Si solo cambias el dashboard, no necesitas `pnpm build` (el dashboard es JS puro, no TypeScript).

---

## 6. Migrar desde PM2

Si actualmente usas PM2:

```bash
# 1. Parar y eliminar PM2
pm2 stop all
pm2 delete all

# 2. (Opcional) Desinstalar PM2 globalmente
npm uninstall -g pm2

# 3. Seguir los pasos de "Setup Inicial" (sección 1.4 y 1.5)
```

---

## 7. Troubleshooting

### El servicio no arranca
```bash
# Ver los logs de error
sudo journalctl -u ciberpadre -n 50 --no-pager

# Verificar que el build es correcto
cd /opt/automaton && node dist/index.js --status
```

### El servicio se reinicia en bucle
```bash
# Ver cuántas veces se reinició
sudo systemctl show ciberpadre --property=NRestarts

# Deshabilitar restart temporal para depurar
sudo systemctl stop ciberpadre
node dist/index.js --run   # Ejecutar manual para ver el error
```

### Workers zombie después de un restart
Con el fix del shutdown handler, esto ya no debería pasar. Pero si ocurre:
```bash
# El orchestrator limpia automáticamente en el primer tick post-restart.
# Si persiste, puedes reiniciar limpiamente:
sudo systemctl restart ciberpadre
```

### Cambiar la ruta de la base de datos
Edita `/etc/systemd/system/ciberpadre-dashboard.service`:
```ini
Environment=DASHBOARD_STATE_DB_PATH=/ruta/a/tu/state.db
```
Luego: `sudo systemctl daemon-reload && sudo systemctl restart ciberpadre-dashboard`

### Cambiar el puerto del dashboard
Edita `/etc/systemd/system/ciberpadre-dashboard.service`:
```ini
Environment=DASHBOARD_PORT=8080
```
Luego: `sudo systemctl daemon-reload && sudo systemctl restart ciberpadre-dashboard`

---

## 8. Resumen Rápido de Comandos

| Acción | Comando |
|---|---|
| Arrancar CiberPadre | `sudo systemctl start ciberpadre` |
| Parar CiberPadre | `sudo systemctl stop ciberpadre` |
| Reiniciar CiberPadre | `sudo systemctl restart ciberpadre` |
| Ver estado | `sudo systemctl status ciberpadre` |
| Ver logs (vivo) | `sudo journalctl -u ciberpadre -f` |
| Ver logs (últimas N) | `sudo journalctl -u ciberpadre -n 100` |
| Arrancar Dashboard | `sudo systemctl start ciberpadre-dashboard` |
| Parar Dashboard | `sudo systemctl stop ciberpadre-dashboard` |
| Actualizar todo | `stop → git pull → pnpm install → pnpm build → start` |

---

## PM2 vs systemd — Diferencias Clave

| Característica | PM2 | systemd |
|---|---|---|
| Reinicio agresivo | ✅ (mata workers en memoria) | ❌ (espera SIGTERM + 15s) |
| Sobrevive reboot | Con `pm2 save` | Con `systemctl enable` |
| Sobrevive SSH close | ✅ | ✅ |
| Logs | `pm2 logs` | `journalctl -u servicio -f` |
| Workers zombie | ⚠ Frecuente | ❌ Mitigado por shutdown hook |
| Gestión independiente | Difícil | ✅ Cada servicio es independiente |
