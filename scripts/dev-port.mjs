/**
 * Pick a free dev-server port so Loomria does not collide with other local projects.
 * Starts at the preferred port (1420) and walks upward until one is free on every
 * address a dev server could bind (IPv4 loopback, IPv6 loopback, all interfaces).
 */
import net from 'node:net';

export const PREFERRED_DEV_PORT = 1420;
const MAX_TRIES = 100;
const HOSTS = ['127.0.0.1', '::1', '0.0.0.0', '::'];

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      // A family this machine does not support cannot be in conflict.
      resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL');
    });
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen({ port, host, exclusive: true });
  });
}

export async function isPortFree(port) {
  for (const host of HOSTS) {
    if (!(await canListen(port, host))) return false;
  }
  return true;
}

export async function pickDevPort(preferred = PREFERRED_DEV_PORT) {
  for (let port = preferred; port < preferred + MAX_TRIES; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free dev port in ${preferred}-${preferred + MAX_TRIES - 1}`);
}
