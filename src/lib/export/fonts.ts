import path from 'path';
import { Font } from '@react-pdf/renderer';

/**
 * Register Satoshi as the PDF font family.
 *
 * Satoshi is Vantor's product font (Fontshare-hosted on the web). For
 * @react-pdf/renderer we embed the TTF files shipped in `public/fonts/`
 * so the rendered PDF is identical regardless of where it's generated
 * (browser, edge runtime, Node server).
 *
 * Falls back to `Helvetica` automatically if a weight is missing.
 */

let registered = false;

function resolveFontPath(file: string): string {
  if (typeof window !== 'undefined') {
    return `/fonts/${file}`;
  }
  return path.join(process.cwd(), 'public', 'fonts', file);
}

export function registerPdfFonts(): void {
  if (registered) return;

  Font.register({
    family: 'Satoshi',
    fonts: [
      { src: resolveFontPath('Satoshi-Regular.ttf'), fontWeight: 400 },
      { src: resolveFontPath('Satoshi-Medium.ttf'), fontWeight: 500 },
      { src: resolveFontPath('Satoshi-Bold.ttf'), fontWeight: 700 },
    ],
  });

  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

registerPdfFonts();
