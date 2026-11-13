import fs from "node:fs";

const source = fs.readFileSync(".vm-ctx/Dockerfile", "utf8");
const start = source.indexOf("# Noto Sans CJK JP is distributed");
const endMarker = "    fc-cache -f";
const end = source.indexOf(endMarker, start) + endMarker.length;
if (start < 0 || end < endMarker.length) throw new Error("font block not found");

const replacement = [
  "COPY NotoSansCJKjp-Regular.otf /usr/local/share/fonts/NotoSansCJKjp-Regular.otf",
  "COPY OFL.txt /usr/local/share/licenses/noto-cjk/OFL.txt",
  "RUN set -eux; \\",
  "    echo '68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5  /usr/local/share/fonts/NotoSansCJKjp-Regular.otf' | sha256sum -c -; \\",
  "    chmod 0644 /usr/local/share/fonts/NotoSansCJKjp-Regular.otf; \\",
  "    echo '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2  /usr/local/share/licenses/noto-cjk/OFL.txt' | sha256sum -c -; \\",
  "    fc-cache -f",
].join("\n");

fs.writeFileSync(".vm-ctx2/Dockerfile", source.slice(0, start) + replacement + source.slice(end));
console.log("patched:", fs.statSync(".vm-ctx2/Dockerfile").size, "bytes");
