// src/lib/download.js
//
// v18.4.5 (ROADMAP #17) — hand the browser a text file to save. The one piece of
// "Download backup" and the Activity log's CSV that needs a DOM; it was written
// out in both handlers in App. THROWS when the browser cannot make the file, so
// each caller says so in its own place (under the backup button; the banner for
// the CSV). The object URL is released a second later: revoking it at once can
// cancel the download it was made for.

export function saveTextFile(text, filename, type) {
  const blob = new Blob([text], { type: type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
