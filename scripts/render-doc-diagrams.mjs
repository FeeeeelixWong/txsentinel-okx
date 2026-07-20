import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "docs", "diagrams");
const outputDirectory = path.join(root, "docs", "assets");
const sourceFiles = (await fs.readdir(sourceDirectory))
  .filter((file) => file.endsWith(".mmd"))
  .sort();

await fs.mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" });
  await page.evaluate(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      flowchart: { curve: "basis", htmlLabels: false, useMaxWidth: true },
      sequence: { useMaxWidth: true, wrap: true },
      themeVariables: {
        background: "#0d1117",
        primaryColor: "#171d23",
        primaryTextColor: "#f0f3f5",
        primaryBorderColor: "#8b949e",
        secondaryColor: "#202831",
        tertiaryColor: "#111820",
        lineColor: "#9da7b1",
        textColor: "#f0f3f5",
        noteBkgColor: "#202831",
        noteTextColor: "#f0f3f5",
        noteBorderColor: "#8b949e",
        actorBkg: "#171d23",
        actorBorder: "#8b949e",
        actorTextColor: "#f0f3f5",
        signalColor: "#9da7b1",
        signalTextColor: "#f0f3f5",
        labelBoxBkgColor: "#171d23",
        labelBoxBorderColor: "#8b949e",
        labelTextColor: "#f0f3f5"
      }
    });
  });

  for (const sourceFile of sourceFiles) {
    const source = await fs.readFile(path.join(sourceDirectory, sourceFile), "utf8");
    const id = `txsentinel-${path.basename(sourceFile, ".mmd").replace(/[^a-z0-9-]/gi, "-")}`;
    const svg = await page.evaluate(async ({ id: renderId, definition }) => {
      const rendered = await mermaid.render(renderId, definition);
      return rendered.svg;
    }, { id, definition: source });
    const accessibleSvg = svg
      .replace("<svg ", `<svg aria-label="${id}" `)
      .replace('role="graphics-document document"', 'role="img"')
      .replace(/style="max-width: [^"]+;"/, "style=\"max-width: 100%; background: #0d1117;\"");
    await fs.writeFile(
      path.join(outputDirectory, sourceFile.replace(/\.mmd$/, ".svg")),
      `${accessibleSvg}\n`
    );
  }
} finally {
  await browser.close();
}

console.log(`Rendered ${sourceFiles.length} documentation diagrams.`);
