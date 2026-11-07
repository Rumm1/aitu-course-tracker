import {normalize, certificateURL} from './core.js';

const TOKENS = /[\p{L}\p{N}+#]+/gu;
const URLS = /https:\/\/[^\s<>"()]+/giu;
const PERCENT = /(?<![\p{L}\p{N}.+\-])(\d{1,3}(?:[.,]\d+)?)\s*%/giu;
const DONE = /^(?:(?:course|program|specialization|курс|программа|специализация)\s+)?(?:completed|complete|finished|passed|заверш[её]н(?:о|а|ы)?|заверш[её]нн(?:ые|ых|ый|ая)|пройден(?:о|а|ы)?|пройденн(?:ые|ых|ый|ая)|успешно\s+заверш[её]н(?:о|а)?)(?:\s+(?:on|at|от|дата)\b.*|\s*[·:—–-]\s*.*|\s*\(?\d+\)?)?$/iu;
const ACTIVE = /^(?:in\s+progress|currently\s+learning|в\s+процессе|в\s+работе|продолжить(?:\s+обучение)?|continue(?:\s+(?:learning|course))?|resume(?:\s+course)?)(?:\s*\(?\d+\)?)?$/iu;
const NOISE = /^(?:my\s+(?:learning|courses)|мо[её]\s+обучение|мои\s+курсы|coursera|explore|browse|saved|сохран[её]нн(?:ое|ые)|accomplishments|достижения|courses?|курсы?|specializations?|специализации|professional\s+certificates?|профессиональные\s+сертификаты|view\s+(?:course|certificate)|go\s+to\s+course|открыть\s+(?:курс|сертификат)|show\s+(?:more|all)|показать\s+(?:ещ[её]|все)|learn\s+more|подробнее|filter(?:s)?|фильтр(?:ы)?|sort\s+by|сортировка|all|все|home|главная|search|поиск|help|помощь|support|поддержка|account|аккаунт|profile|профиль|log\s*out|выйти|menu|меню|language|язык|privacy|конфиденциальность|terms|условия|notifications|уведомления|settings|настройки|share|поделиться|enroll(?:ed)?|зарегистрироваться|оценка|grade|задачи|задания|progress|прогресс|завершение|completion)(?:\s*[:·—–-]?\s*\d+)?$/iu;
const RECOMMENDATIONS = /^(?:recommended(?:\s+(?:for\s+you|courses))?|recommendations|you\s+might\s+(?:also\s+)?like|related\s+courses|похожие\s+курсы|рекомендации|рекомендуем(?:ые|\s+вам)?|вам\s+может\s+понравиться)$/iu;

function headingStatus(line) {
  const value = line.trim().replace(/^[•·▪\-–—]+\s*/, '');
  if (DONE.test(value)) return 'done';
  if (ACTIVE.test(value)) return 'active';
  return undefined;
}

function containsPhrase(haystack, phrase) {
  return (' ' + normalize(haystack) + ' ').includes(' ' + normalize(phrase) + ' ');
}

function providerMatches(text, course) {
  return String(course.provider || '').split(';').some(provider => provider.trim() && containsPhrase(text, provider));
}

function extractProgress(text) {
  const percentages = [...text.matchAll(PERCENT)].map(match => Number(match[1].replace(',', '.'))).filter(value => value >= 0 && value <= 100);
  if (percentages.length) return {percent: percentages[0], progressSource: 'percent'};
  // A bare "3/10" could be a grade or date. Only explicit task/lesson counts
  // are sufficient evidence to calculate a learning percentage.
  const after = /\b(\d+)\s*(?:из|of|\/)\s*(\d+)\s*(?:задани[йяея]*|tasks?|assignments?|lessons?|урок(?:ов|а)?|modules?|модул(?:ей|я)?)(?=$|[\s,.;])/iu;
  const before = /(?:задани[йяея]*|tasks?|assignments?|lessons?|урок(?:ов|а)?|modules?|модул(?:ей|я)?)\s*[:—–-]?\s*(\d+)\s*(?:из|of|\/)\s*(\d+)(?=$|[\s,.;])/iu;
  const counts = text.match(after) || text.match(before);
  if (counts) {
    const completedTasks = Number(counts[1]), totalTasks = Number(counts[2]);
    if (totalTasks > 0 && completedTasks >= 0 && completedTasks <= totalTasks) return {
      percent: Math.round(completedTasks / totalTasks * 100),
      progressSource: 'tasks', completedTasks, totalTasks,
    };
  }
  return {};
}

function metadataOnly(text, candidates) {
  let value = text.replace(URLS, ' ').replace(PERCENT, ' ');
  for (const candidate of candidates) for (const provider of String(candidate.provider || '').split(';')) {
    if (!provider.trim()) continue;
    const words = normalize(provider).split(' ');
    const tokens = [...value.matchAll(TOKENS)];
    for (let i = tokens.length - words.length; i >= 0; i--) {
      if (words.every((word, offset) => normalize(tokens[i + offset][0]) === word)) {
        const start = tokens[i].index, end = tokens[i + words.length - 1].index + tokens[i + words.length - 1][0].length;
        value = value.slice(0, start) + ' ' + value.slice(end);
      }
    }
  }
  value = normalize(value)
    .replace(/\b(?:course|courses|program|specialization|professional certificate|completed|complete|finished|in progress|continue learning|resume course|progress|percent)\b/gu, ' ')
    .replace(/(?:курс|курсы|программа|специализация|пройдено|пройден|завершено|заверш[её]н|в процессе|в работе|прогресс|выполнено)/gu, ' ')
    .replace(/\d+/g, ' ').trim();
  return !value;
}

function findTitleSpans(text, catalog) {
  const tokens = [...text.matchAll(TOKENS)].map(match => ({value: normalize(match[0]), start: match.index, end: match.index + match[0].length}));
  const aliases = new Map();
  for (const course of catalog) for (const title of [course.title, ...course.also || []]) {
    const words = normalize(title).split(' ').filter(Boolean);
    if (!words.length) continue;
    const bucket = aliases.get(words[0]) || [];
    bucket.push({words, course}); aliases.set(words[0], bucket);
  }
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const alias of aliases.get(tokens[i].value) || []) {
      if (!alias.words.every((word, offset) => tokens[i + offset]?.value === word)) continue;
      const start = tokens[i].start, end = tokens[i + alias.words.length - 1].end;
      const existing = found.find(span => span.start === start && span.end === end);
      if (existing) {if (!existing.candidates.some(c => c.id === alias.course.id)) existing.candidates.push(alias.course);}
      else found.push({start, end, title: text.slice(start, end).replace(/\s+/g, ' '), candidates: [alias.course]});
    }
  }
  // A program or longer verified alias wins over an individual course name
  // occurring inside that exact title. It never completes its child courses.
  const longest = found.filter(span => !found.some(other => other !== span && other.start <= span.start && other.end >= span.end && other.end - other.start > span.end - span.start));
  longest.sort((a, b) => a.start - b.start || b.end - a.end);
  return longest.filter((span, i) => {
    const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
    const lineEndRaw = text.indexOf('\n', span.end), lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    const previous = longest[i - 1], next = longest[i + 1];
    const prefixStart = previous && previous.end >= lineStart ? previous.end : lineStart;
    const suffixEnd = next && next.start <= lineEnd ? next.start : lineEnd;
    return metadataOnly(text.slice(prefixStart, span.start), span.candidates) && metadataOnly(text.slice(span.end, suffixEnd), span.candidates);
  });
}

function mergeMatches(previous, incoming) {
  if (!previous) return incoming;
  const done = previous.status === 'done' || incoming.status === 'done';
  const bestProgress = (incoming.percent ?? -1) >= (previous.percent ?? -1) ? incoming : previous;
  const result = {...previous, ...incoming, status: done ? 'done' : incoming.status};
  if (!done) for (const key of ['percent', 'progressSource', 'completedTasks', 'totalTasks']) {
    if (bestProgress[key] !== undefined) result[key] = bestProgress[key];
  }
  else for (const key of ['percent', 'progressSource', 'completedTasks', 'totalTasks']) delete result[key];
  result.certificateUrl = incoming.certificateUrl || previous.certificateUrl;
  if (!result.certificateUrl) delete result.certificateUrl;
  return result;
}

/**
 * Parse user-copied Coursera learning lists locally, without a browser session.
 * `mode` is the section the user deliberately selected; explicit copied status
 * headings or actual percentages take precedence over that fallback.
 */
export function parseProgressText(input, catalog, {mode = 'done'} = {}) {
  if (typeof input !== 'string') throw new TypeError('Вставьте текст списка курсов');
  if (input.length > 500000) throw new RangeError('Список слишком большой: вставьте до 500 000 символов за одну проверку');
  if (!['done', 'active', 'mixed'].includes(mode)) throw new TypeError('Неизвестный раздел списка');
  const text = input.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ');
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(match => match[0]).map(match => ({start: match.index, end: match.index + match[0].length, text: match[0].trim()}));
  const headings = lines.map(line => ({...line, status: headingStatus(line.text), ignored: RECOMMENDATIONS.test(line.text)})).filter(line => line.status || line.ignored);
  const spans = findTitleSpans(text, catalog), groups = [];
  for (const span of spans) {
    const previous = groups[groups.length - 1];
    if (previous && previous.candidates.map(c => c.id).join('|') === span.candidates.map(c => c.id).join('|') && metadataOnly(text.slice(previous.end, span.start), span.candidates)) previous.end = span.end;
    else groups.push({...span});
  }
  const matches = new Map(), ambiguous = [], warnings = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i], next = groups[i + 1];
    const section = headings.filter(heading => heading.start < group.start).at(-1);
    if (section?.ignored) continue;
    const following = text.slice(group.end, next?.start ?? text.length).slice(0, 2000);
    const previousLineStart = text.lastIndexOf('\n', Math.max(0, group.start - 2));
    const beforeTitle = text.slice(previousLineStart < 0 ? 0 : previousLineStart, group.start).slice(-350);
    const context = beforeTitle + '\n' + following;
    let candidates = group.candidates;
    const previousProviders = candidates.filter(course => providerMatches(beforeTitle, course));
    const providers = previousProviders.length ? previousProviders : candidates.filter(course => providerMatches(following, course));
    if (providers.length) candidates = providers;
    if (candidates.length > 1) {
      const program = /(?:^|\n)\s*(?:specialization|специализация|professional certificate|профессиональная программа)\s*(?:\n|$)/iu.test(context);
      const kindCandidates = candidates.filter(course => program ? ['specialization', 'professional-certificate'].includes(course.kind) : true);
      if (kindCandidates.length) candidates = kindCandidates;
    }
    const progress = extractProgress(following);
    const localStatuses = following.split('\n').map(headingStatus).filter(Boolean);
    let explicit = localStatuses[0];
    // A final differing heading before the next title starts that next section;
    // it is not evidence that the last card of the previous section changed.
    if (next && section?.status && localStatuses.length === 1 && explicit !== section.status && headingStatus(following.trim().split('\n').at(-1)) === explicit) explicit = undefined;
    // Explicit completion is stronger evidence than a displayed percentage,
    // which can be a grade or an optional-content progress value. The user's
    // fallback mode is weaker: a bare 67% still describes an active course.
    const governingStatus = explicit || section?.status;
    const status = governingStatus === 'done' ? 'done'
      : governingStatus === 'active' || progress.percent !== undefined ? 'active'
        : mode === 'mixed' ? undefined : mode;
    const record = {title: group.title, status, ...(status === 'active' ? progress : {})};
    if (candidates.length !== 1 || !status) {
      ambiguous.push({...record, candidates: candidates.map(course => course.id), reason: !status ? 'Не указан раздел или статус курса' : 'У нескольких курсов одинаковое название'});
      continue;
    }
    const course = candidates[0], urls = [...following.matchAll(URLS)].map(match => certificateURL(match[0].replace(/[.,;]+$/, ''), course)).filter(Boolean);
    const uniqueURLs = [...new Set(urls)];
    if (uniqueURLs.length === 1) record.certificateUrl = uniqueURLs[0];
    else if (uniqueURLs.length > 1) warnings.push({courseId: course.id, reason: 'Найдено несколько разных ссылок сертификата; ссылка не выбрана автоматически'});
    matches.set(course.id, mergeMatches(matches.get(course.id), {courseId: course.id, ...record}));
  }
  const providerNames = catalog.flatMap(course => String(course.provider || '').split(';')).map(normalize).filter(Boolean);
  const unmatched = [];
  for (const line of lines) {
    if (!line.text || spans.some(span => span.start < line.end && span.end > line.start)) continue;
    if (headings.some(heading => heading.start === line.start) || NOISE.test(line.text) || RECOMMENDATIONS.test(line.text)) continue;
    if (providerNames.includes(normalize(line.text)) || URLS.test(line.text) || extractProgress(line.text).percent !== undefined) {URLS.lastIndex = 0; continue;}
    URLS.lastIndex = 0;
    if (line.text.length < 6 || normalize(line.text).split(' ').length < 2 || /^\d|^(?:©|copyright)|^(?:https?:|www\.)/iu.test(line.text)) continue;
    if (!unmatched.some(item => normalize(item.title) === normalize(line.text))) unmatched.push({title: line.text, reason: 'Нет точного совпадения в каталоге'});
    if (unmatched.length >= 40) break;
  }
  return {matches: [...matches.values()], ambiguous, unmatched, warnings};
}
