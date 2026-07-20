const copyButton = document.getElementById("copy-request");
const requestExample = document.getElementById("request-example");

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(requestExample.innerText);
    copyButton.textContent = "Copied";
  } catch {
    copyButton.textContent = "Copy failed";
  }
  window.setTimeout(() => { copyButton.textContent = "Copy request"; }, 1400);
});
