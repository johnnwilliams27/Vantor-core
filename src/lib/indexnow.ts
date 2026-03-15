const INDEXNOW_KEY = 'fd7aacb7bd3aa0aa479fa2785e2bda0a';
const SITE_HOST = 'www.vantor.xyz';
const KEY_LOCATION = `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`;

/** Public pages that should be indexed */
export const PUBLIC_URLS = [
  `https://${SITE_HOST}`,
  `https://${SITE_HOST}/privacy`,
  `https://${SITE_HOST}/terms`,
];

/**
 * Submit one or more URLs to IndexNow.
 * Notifies Bing, Yandex, Seznam, and Naver simultaneously.
 */
export async function submitToIndexNow(urls?: string[]): Promise<{ ok: boolean; status: number }> {
  const urlList = urls ?? PUBLIC_URLS;

  const body = {
    host: SITE_HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList,
  };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });

  return { ok: res.ok, status: res.status };
}
