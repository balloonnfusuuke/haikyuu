// Poly Haven (CC0) の 1k HDR を public/hdri に落とす。
// 昼: kloofendal_48d_partly_cloudy_puresky
// 夜: moonlit_golf

const files = {
  "public/hdri/day.hdr":
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr",
  "public/hdri/night.hdr":
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonlit_golf_1k.hdr",
};

const headers = { "User-Agent": "plate-tip" };

for (const [path, url] of Object.entries(files)) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(path, bytes));
  console.log(path, bytes.length);
}
