const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

async function main() {
  const root = __dirname;
  const flowTypes = path.join(root, "dist", "FlowMembrane.js.flow");
  const clientTypes = path.join(root, "dist", "Client.js.flow");
  const serverTypes = path.join(root, "dist", "Server.js.flow");

  for (const typeFile of [flowTypes, clientTypes, serverTypes]) {
    if (!fs.existsSync(typeFile)) {
      throw new Error(`Missing ${path.relative(root, typeFile)}`);
    }
  }

  const cjs = require(path.join(root, "dist", "FlowMembrane.js"));
  if (typeof cjs.app !== "function" || typeof cjs.route !== "function") {
    throw new Error("CJS public API smoke failed");
  }
  const home = cjs.lazy(async () => ({ default: () => null }));
  const myApp = cjs.app({
    routes: [
      cjs.route("/", { id: "root", module: home }),
      cjs.route("/p/:id", { id: "product", module: home }),
    ],
  });
  const match = myApp.match("/p/9");
  if (match == null || match.params.id !== "9") {
    throw new Error("CJS matcher smoke failed");
  }
  const dispatched = await cjs.dispatch(myApp, "/p/abc");
  if (dispatched.kind !== "render") {
    throw new Error("CJS dispatch smoke failed");
  }

  const esm = await import(pathToFileURL(path.join(root, "dist", "FlowMembrane.mjs")).href);
  const esmMatch = esm.matchRoute(
    [esm.route("/", { id: "root", module: esm.lazy(async () => ({ default: () => null })) })],
    "/",
  );
  if (esmMatch == null || esmMatch.route.id !== "root") {
    throw new Error("ESM smoke failed");
  }

  const server = await import(pathToFileURL(path.join(root, "dist", "Server.mjs")).href);
  if (
    typeof server.app !== "function" ||
    typeof server.dispatch !== "function" ||
    Object.hasOwn(server, "Link") ||
    Object.hasOwn(server, "useNavigation")
  ) {
    throw new Error("RSC server entry smoke failed");
  }

  const clientSource = fs.readFileSync(path.join(root, "dist", "Client.mjs"), "utf8");
  if (
    !clientSource.includes("\"use client\"") ||
    !clientSource.includes("Link") ||
    !clientSource.includes("navigate")
  ) {
    throw new Error("RSC client entry smoke failed");
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
