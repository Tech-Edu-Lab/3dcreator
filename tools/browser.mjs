// 確認用: ヘッドレス Chromium を起動する（test/e2e.mjs から使う）。
// Chromium に必要なライブラリが OS に入っていないときは、環境変数 CHROMIUM_LIBS に
// ライブラリを置いたフォルダを指定すると、そこから読みこむ。
import { chromium } from 'playwright';

export async function launch() {
  const env = { ...process.env };
  if (process.env.CHROMIUM_LIBS) env.LD_LIBRARY_PATH = [process.env.CHROMIUM_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  return chromium.launch({
    env,
    // 画面のない環境でも 3D（WebGL）が動くように、ソフトウェア描画を使う
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}
