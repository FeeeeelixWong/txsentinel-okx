import { spawn } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.DEMO_APP_URL || "https://txsentinel-okx.vercel.app";
const evaluateUrl = new URL("/evaluate.html", appUrl).toString();
const outputDir = resolve("output/submission");
const tempDir = resolve("tmp/demo-video");
const voiceDir = join(tempDir, "voice");
const rawVideo = join(tempDir, "txsentinel.raw.webm");
const narration = join(tempDir, "txsentinel-narration.wav");
const concatList = join(tempDir, "voice-list.txt");
const finalVideo = join(outputDir, "txsentinel-okx-demo.mp4");
const finalSubtitles = join(outputDir, "txsentinel-okx-demo.srt");
const edgePython = resolve("../agentpay-firewall/tmp/edge-tts-venv/bin/python");
const voice = process.env.DEMO_TTS_VOICE || "en-US-AvaMultilingualNeural";

const segments = [
  {
    minDuration: 7,
    scene: "intro",
    voiceover: "Autonomous agents can execute transactions, but executable does not mean authorized. This is TxSentinel, a policy firewall for agentic wallets.",
  },
  {
    minDuration: 9,
    scene: "product",
    voiceover: "The agent submits a proposed action, the user's guardrails, and simulation evidence. TxSentinel never receives a private key and cannot sign or broadcast.",
  },
  {
    minDuration: 11,
    scene: "allow",
    voiceover: "First, a routine transfer on X Layer stays below the spend and fee caps. The live API returns ALLOW, risk zero, and a deterministic receipt.",
  },
  {
    minDuration: 11,
    scene: "hold",
    voiceover: "Next, an eight-hundred-fifty-dollar swap exceeds a five-hundred-dollar mandate. Execution may be possible, but policy returns HOLD with exact limit evidence.",
  },
  {
    minDuration: 11,
    scene: "deny",
    voiceover: "An unlimited token approval crosses a hard boundary. TxSentinel returns DENY, risk one hundred, and identifies the critical rule without exposing signing authority.",
  },
  {
    minDuration: 13,
    scene: "receipt",
    voiceover: "Every response contains normalized inputs, the policy version, rule evidence, an action digest, and a SHA-two-fifty-six receipt. Identical inputs reproduce the same receipt hash.",
  },
  {
    minDuration: 13,
    scene: "integration",
    voiceover: "The free review API is live. A separate paid endpoint integrates the official OKX x402 Express, Core, and EVM packages for pay-per-check access by Agentic Wallets.",
  },
  {
    minDuration: 8,
    scene: "outro",
    voiceover: "TxSentinel separates what an agent can do from what it is allowed to do, before the wallet signs.",
  },
];

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

const run = (command, args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, args, {
    cwd: resolve("."),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.on("error", rejectRun);
  child.on("close", (code) => {
    if (code === 0) resolveRun({ stdout, stderr });
    else rejectRun(new Error(`${command} failed with code ${code}\n${stdout}\n${stderr}`));
  });
});

const probeDuration = async (filePath) => {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid media: ${filePath}`);
  return duration;
};

const synthesize = async (textPath, audioPath) => {
  try {
    await run(edgePython, [
      "-m", "edge_tts", "--voice", voice, "--rate", "+4%", "--file", textPath,
      "--write-media", audioPath,
    ]);
  } catch {
    const fallback = audioPath.replace(/\.mp3$/, ".aiff");
    await run("say", ["-v", "Ava", "-r", "170", "-f", textPath, "-o", fallback]);
    return fallback;
  }
  return audioPath;
};

const prepareNarration = async () => {
  const timed = [];
  await mkdir(voiceDir, { recursive: true });
  for (const [index, segment] of segments.entries()) {
    const key = String(index + 1).padStart(2, "0");
    const textPath = join(voiceDir, `${key}.txt`);
    const mediaPath = join(voiceDir, `${key}.mp3`);
    const paddedPath = join(voiceDir, `${key}.wav`);
    await writeFile(textPath, `${segment.voiceover}\n`);
    const sourcePath = await synthesize(textPath, mediaPath);
    const audioDuration = await probeDuration(sourcePath);
    const duration = Number(Math.max(segment.minDuration, audioDuration + 0.5).toFixed(3));
    await run("ffmpeg", [
      "-y", "-i", sourcePath,
      "-af", `apad=pad_dur=${Math.max(0, duration - audioDuration).toFixed(3)},atrim=0:${duration},asetpts=N/SR/TB`,
      "-ar", "48000", "-ac", "1", paddedPath,
    ]);
    timed.push({ ...segment, duration, paddedPath });
  }
  await writeFile(concatList, `${timed.map((segment) => `file '${segment.paddedPath.replaceAll("'", "'\\''")}'`).join("\n")}\n`);
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c:a", "pcm_s16le", narration]);
  return timed;
};

const srtTime = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

const buildSrt = (timed) => {
  let cursor = 0;
  return `${timed.map((segment, index) => {
    const start = cursor;
    cursor += segment.duration;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${segment.voiceover}\n`;
  }).join("\n")}\n`;
};

const installDemoStyles = (page) => page.addStyleTag({ content: `
  #demo-caption { position: fixed; left: 50%; bottom: 24px; z-index: 100001; width: min(1320px, calc(100vw - 72px)); transform: translateX(-50%); padding: 13px 18px; box-sizing: border-box; border: 1px solid rgba(203,244,62,.38); border-radius: 5px; background: rgba(5,8,10,.92); color: #fff; font: 700 20px/1.35 Inter, ui-sans-serif, system-ui, sans-serif; text-align: center; }
  #demo-scene { position: fixed; inset: 0; z-index: 100000; display: flex; flex-direction: column; justify-content: center; padding: 80px 100px 120px; box-sizing: border-box; background: #080b0d; color: #f4f6f7; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  #demo-scene .eyebrow { color: #cbf43e; font: 800 18px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
  #demo-scene h1 { max-width: 1180px; margin: 20px 0; font-size: 74px; line-height: 1.02; letter-spacing: 0; }
  #demo-scene p { max-width: 1000px; margin: 0; color: #aab5bb; font-size: 27px; line-height: 1.45; }
  #demo-scene .flow-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 38px; }
  #demo-scene .flow-grid div { min-height: 150px; padding: 24px; border: 1px solid #3b4952; border-radius: 5px; background: #0d1114; }
  #demo-scene .flow-grid b { display: block; margin-bottom: 12px; color: #55d6d2; font-size: 25px; }
  #demo-scene .flow-grid span { color: #aab5bb; font-size: 19px; line-height: 1.4; }
  #demo-scene .stack { display: grid; gap: 12px; width: 580px; margin-top: 34px; }
  #demo-scene .stack div { padding: 17px 20px; border-left: 4px solid #cbf43e; background: #11171b; font: 700 20px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
` });

const showScene = (page, kind) => page.evaluate((sceneKind) => {
  document.getElementById("demo-scene")?.remove();
  const scene = document.createElement("section");
  scene.id = "demo-scene";
  if (sceneKind === "intro") {
    scene.innerHTML = `<span class="eyebrow">TXSENTINEL / OKX.AI GENESIS HACKATHON</span><h1>Inspect the action before the agent signs.</h1><p>A deterministic transaction policy firewall for autonomous agents and Agentic Wallets.</p>`;
  } else if (sceneKind === "integration") {
    scene.innerHTML = `<span class="eyebrow">OFFICIAL OKX INTEGRATION</span><h1>One policy boundary. Two access paths.</h1><div class="flow-grid"><div><b>Free review API</b><span>Live policy checks for judges and ASP review.</span></div><div><b>Official x402 route</b><span>Express, Core, and EVM SDK packages integrated.</span></div><div><b>No signing authority</b><span>The firewall never receives keys or broadcasts transactions.</span></div></div>`;
  } else {
    scene.innerHTML = `<span class="eyebrow">TXSENTINEL / ASP #6828</span><h1>Policy before signing.</h1><p>ALLOW safe actions. HOLD exceptions. DENY hard violations.</p><div class="stack"><div>POST /api/check</div><div>POST /api/check-paid</div><div>SHA-256 deterministic receipt</div></div>`;
  }
  document.body.appendChild(scene);
}, kind);

const hideScene = (page) => page.evaluate(() => document.getElementById("demo-scene")?.remove());

const showCaption = (page, text) => page.evaluate((captionText) => {
  let caption = document.getElementById("demo-caption");
  if (!caption) {
    caption = document.createElement("div");
    caption.id = "demo-caption";
    document.body.appendChild(caption);
  }
  caption.textContent = captionText;
}, text);

const evaluateScenario = async (page, name, decision) => {
  await page.getByRole("button", { name: new RegExp(name, "i") }).click();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: /Continue/i }).click();
  }
  await page.getByRole("button", { name: /Evaluate transaction/i }).click();
  await page.locator("#decision-badge").getByText(decision, { exact: true }).waitFor({ timeout: 10_000 });
  await page.locator(".wizard-shell").scrollIntoViewIfNeeded();
};

const step = async (page, segment, action) => {
  const started = Date.now();
  await showCaption(page, segment.voiceover);
  if (action) await action();
  const remaining = segment.duration * 1000 - (Date.now() - started);
  if (remaining < -300) throw new Error(`Scene ${segment.scene} exceeded its audio slot by ${Math.abs(remaining).toFixed(0)}ms`);
  if (remaining > 0) await pause(remaining);
};

const record = async (timed) => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      recordVideo: { dir: tempDir, size: { width: 1600, height: 900 } },
    });
    const page = await context.newPage();
    await page.goto(evaluateUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByRole("button", { name: /Continue/i }).waitFor({ timeout: 30_000 });
    await installDemoStyles(page);

    await step(page, timed[0], () => showScene(page, "intro"));
    await step(page, timed[1], async () => {
      await hideScene(page);
      await page.evaluate(() => window.scrollTo(0, 0));
    });
    await step(page, timed[2], () => evaluateScenario(page, "Routine transfer", "ALLOW"));
    await step(page, timed[3], () => evaluateScenario(page, "Spend cap breach", "HOLD"));
    await step(page, timed[4], () => evaluateScenario(page, "Unlimited approval", "DENY"));
    await step(page, timed[5], async () => {
      await page.locator("#receipt-content details").evaluate((element) => { element.open = true; });
      await page.locator("#receipt-content").scrollIntoViewIfNeeded();
    });
    await step(page, timed[6], () => showScene(page, "integration"));
    await step(page, timed[7], () => showScene(page, "outro"));

    const video = page.video();
    await context.close();
    if (!video) throw new Error("Playwright did not create a video");
    await copyFile(await video.path(), rawVideo);
  } finally {
    await browser.close();
  }
};

await rm(tempDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(tempDir, { recursive: true });

const timed = await prepareNarration();
const duration = timed.reduce((total, segment) => total + segment.duration, 0);
if (duration > 90) throw new Error(`Demo is ${duration.toFixed(1)} seconds; target is at most 90 seconds.`);
await writeFile(finalSubtitles, buildSrt(timed));
await record(timed);
const recordedDuration = await probeDuration(rawVideo);
const visualLead = Math.max(0, recordedDuration - duration);

await run("ffmpeg", [
  "-y", "-ss", visualLead.toFixed(3), "-i", rawVideo, "-i", narration,
  "-vf", "fps=30,format=yuv420p,tpad=stop_mode=clone:stop_duration=8",
  "-t", duration.toFixed(3), "-map", "0:v:0", "-map", "1:a:0",
  "-af", "loudnorm=I=-16:TP=-1.5:LRA=9",
  "-c:v", "h264_videotoolbox", "-b:v", "3500k", "-maxrate", "5000k", "-profile:v", "high",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", finalVideo,
]);

console.log(`Video: ${finalVideo}`);
console.log(`Subtitles: ${finalSubtitles}`);
console.log(`Duration: ${duration.toFixed(1)} seconds`);
