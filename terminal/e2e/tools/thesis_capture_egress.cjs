"use strict";
// Loaded only in the explicitly controlled capture's Node child, never the app's
// normal startup. Deny before DNS/socket/fetch; only this owned HTTP port exists.
const net = require("node:net");
function permitted(options, port) {
  return options && !options.path && options.host === "127.0.0.1"
    && Number(options.port) === port;
}
function install(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3100)
    throw Error("THESIS_CAPTURE_EGRESS_CONFIG");
  const denied = () => { throw Error("THESIS_CAPTURE_EXTERNAL_EGRESS_DENIED"); };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = value && typeof value === "object" ? value
      : typeof value === "number" ? {port:value,host:typeof args[1] === "string" ? args[1] : "localhost"} : null;
    if (!permitted(options, port)) return denied();
    return connect.apply(this, args);
  };
  const dns = require("node:dns");
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "reverse"])
    dns[name] = denied;
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "reverse"])
    dns.promises[name] = async () => denied();
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "http:" || url.username || url.password
        || !permitted({host:url.hostname, port:url.port || 80}, port)) return denied();
    return fetch(input, options);
  };
}
if (process.env.THESIS_CAPTURE_SERVER === "1") {
  if (process.env.TERMINAL_E2E_FIXTURE !== "1" || process.env.TERMINAL_F11_PROVIDER_CLOSED !== "1")
    throw Error("THESIS_CAPTURE_EGRESS_SCOPE");
  install(Number(process.env.THESIS_CAPTURE_PORT));
}
module.exports = { permitted, install };
