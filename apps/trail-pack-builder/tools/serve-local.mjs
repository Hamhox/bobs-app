import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const port = Number(portArgument?.split("=")[1] || 8949);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Use --port=NUMBER with a valid local TCP port.");
}

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gpx", "application/gpx+xml; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pmtiles", "application/vnd.pmtiles"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

async function resolveRequestFile(pathname) {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  let filePath = resolve(repositoryRoot, relativePath || "index.html");
  if (filePath !== repositoryRoot && !filePath.startsWith(`${repositoryRoot}${sep}`)) return null;
  let fileStat = await stat(filePath);
  if (fileStat.isDirectory()) {
    filePath = resolve(filePath, "index.html");
    fileStat = await stat(filePath);
  }
  return fileStat.isFile() ? { filePath, fileStat } : null;
}

function streamFile(response, filePath, start, end) {
  const stream = createReadStream(filePath, { start, end });
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

function cacheControlFor(pathname) {
  return /\/web-map\/v2\/generations\/[a-f0-9]{16}\//.test(pathname)
    ? "public, max-age=31536000, immutable"
    : "no-store";
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    const url = new URL(request.url || "/", "http://127.0.0.1");
    const resolvedFile = await resolveRequestFile(url.pathname);
    if (!resolvedFile) {
      response.writeHead(403).end();
      return;
    }

    const { filePath, fileStat } = resolvedFile;
    const headers = {
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControlFor(url.pathname),
      "Content-Type": mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
    };
    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
      if (!match) {
        response.writeHead(416, { ...headers, "Content-Range": `bytes */${fileStat.size}` }).end();
        return;
      }
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : fileStat.size - 1;
      const end = Math.min(requestedEnd, fileStat.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
        response.writeHead(416, { ...headers, "Content-Range": `bytes */${fileStat.size}` }).end();
        return;
      }
      response.writeHead(206, {
        ...headers,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      });
      if (request.method === "HEAD") response.end();
      else streamFile(response, filePath, start, end);
      return;
    }

    response.writeHead(200, { ...headers, "Content-Length": fileStat.size });
    if (request.method === "HEAD") response.end();
    else streamFile(response, filePath, 0, fileStat.size - 1);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end();
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Choose another with --port=NUMBER.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Launch runtime: http://127.0.0.1:${port}/apps/trail-pack-builder/`);
  console.log(
    `Local sources: http://127.0.0.1:${port}/apps/trail-pack-builder/` +
    "?data=./local-data&release=./local-voyager-release",
  );
});
