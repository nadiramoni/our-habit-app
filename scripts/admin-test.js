// Test admin panel switches via agent-browser eval
(function () {
  const panels = Array.from(document.querySelectorAll("div.fixed"));
  const p = panels.find((x) => x.innerText.includes("অ্যাডমিন প্যানেল"));
  if (!p) return "panel not found";
  const sw = Array.from(p.querySelectorAll('button[role="switch"]'));
  const out = [];
  sw.forEach((s, i) => {
    const row = s.closest(".flex")?.parentElement;
    const label = (row?.innerText || "").split("\n")[0].slice(0, 30);
    out.push(i + ": " + label + " = " + s.getAttribute("aria-checked"));
  });
  return out.join(" | ");
})()
