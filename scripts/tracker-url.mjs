export const DEFAULT_TRACKER_URL='https://rumm1.github.io/aitu-course-tracker/';

function canonicalTrackerURL(input){
  let url;
  try{url=new URL(input);}catch{throw Error('TRACKER_URL должен быть полным HTTPS-адресом сайта');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash){
    throw Error('TRACKER_URL должен использовать HTTPS без пароля, параметров и фрагмента');
  }
  // Match-pattern wildcards and encoded separators could widen or change the
  // intended site path. A Pages base URL never requires these forms.
  const raw=String(input),rawPath=raw.match(/^https:\/\/[^/]+(\/[^?#]*)?/i)?.[1]||'/';
  let segments;
  try{segments=rawPath.split('/').map(segment=>decodeURIComponent(segment));}catch{throw Error('TRACKER_URL содержит недопустимый путь сайта');}
  if(/[\\*?#]/.test(raw)||/%(?:2f|5c|2a)/i.test(url.pathname)||/\/{2,}/.test(url.pathname)||segments.some(segment=>segment==='.'||segment==='..')){
    throw Error('TRACKER_URL содержит недопустимый путь сайта');
  }
  url.pathname=url.pathname.replace(/\/+$/,'')+'/';
  return url.href;
}

export function resolveTrackerURL(env={}){
  if(env.TRACKER_URL!==undefined&&typeof env.TRACKER_URL!=='string')throw Error('TRACKER_URL должен быть строкой');
  const explicit=env.TRACKER_URL?.trim();
  if(explicit)return canonicalTrackerURL(explicit);
  if(env.GITHUB_REPOSITORY!==undefined&&typeof env.GITHUB_REPOSITORY!=='string')throw Error('GITHUB_REPOSITORY должен быть строкой');
  const repository=env.GITHUB_REPOSITORY?.trim();
  if(repository){
    const match=repository.match(/^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9_.-]+)$/i);
    if(!match||['.','..'].includes(match[2]))throw Error('GITHUB_REPOSITORY должен иметь вид OWNER/REPOSITORY');
    const owner=match[1].toLowerCase(),name=match[2];
    return canonicalTrackerURL(`https://${owner}.github.io/${name.toLowerCase()===`${owner}.github.io`?'':name}`);
  }
  return DEFAULT_TRACKER_URL;
}

export function trackerExtensionScope(input){
  const url=new URL(canonicalTrackerURL(input));
  return {
    url:url.href,
    origin:url.origin,
    path:url.pathname,
    // Chrome match patterns do not distinguish ports; the include glob and
    // runtime origin check keep the exact URL boundary if a custom port is used.
    matches:[`${url.protocol}//${url.hostname}/*`],
    includeGlobs:[`${url.origin}${url.pathname}*`],
  };
}
