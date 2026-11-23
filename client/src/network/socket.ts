
import { io } from "socket.io-client";
import { buildRevision } from "../config/gameConfig";

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? window.location.origin : "http://localhost:3000");

export const socket = io(SERVER_URL, {
  autoConnect: false,
  withCredentials: true,
  auth: { buildRevision },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

export function connectToServer() {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectFromServer() {
  if (socket.connected) {
    socket.disconnect();
  }
}
