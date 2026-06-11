// 从 icon.png 生成 icon.ico
import pngToIco from 'png-to-ico';
import fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

async function main() {
  // 必须使用方形 PNG（已通过 PowerShell 从原始 77x75 缩放到 256x256）
  const png = await readFile('src-tauri/icons/icon-square.png');
  const buf = await pngToIco(png);
  await writeFile('src-tauri/icons/icon.ico', buf);
  console.log('已生成 icon.ico，大小：', buf.length, '字节');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});