let keywords = [];
let hiddenVideos = new Map(); // Mudando para Map para evitar duplicatas
let isExtensionValid = true;
let lastHiddenCount = 0;
let maxVideoAge = 3; // Idade máxima dos vídeos em anos
let hideWatched = true; // Ocultar vídeos assistidos
let isExtensionEnabled = true; // Estado da extensão
let channelLimit = 2; // Limite de vídeos por canal (0 desativado)
let hidePlaylists = true; // Ocultar playlists / coleções
let enableAltClick = true; // Habilitar Alt+Click ("Não tenho interesse")
let hideAdvancedDiscovery = true; // Ocultar seção "Descoberta avançada de novos temas"
let hideDuplicates = true; // Ocultar cards de vídeos repetidos
let settingsLoaded = false; // Chips só são injetados após ler o estado salvo

// Estado da ordenação
let sortMostViewedActive = false;
let sortMostRecentActive = false;
let injectedChips = [];
let nextOriginalIndex = 0;

// Cards de vídeo: grid da home/inscrições, busca e a sidebar do /watch (que agora usa yt-lockup-view-model solto)
const CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-item-section-renderer yt-lockup-view-model';
const TITLE_SELECTOR = '.ytLockupMetadataViewModelTitle, #video-title';
const LINK_SELECTOR = 'a[href*="/watch?v="], a[href*="list="], a[href*="/playlist?"]';
const METADATA_TEXT_SELECTOR = '.ytContentMetadataViewModelMetadataRow span.ytAttributedStringHost, .ytContentMetadataViewModelMetadataText, #metadata-line span';
const WATCHED_SELECTOR = '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment, ytd-thumbnail-overlay-resume-playback-renderer';

function areChipsConnected() {
  return injectedChips.length > 0 && injectedChips.every(chip => chip.isConnected);
}

// Função para verificar se a extensão ainda é válida
function checkExtensionContext() {
  try {
    chrome.runtime.getURL('');
    return true;
  } catch (e) {
    isExtensionValid = false;
    return false;
  }
}

// Ocultar/mostrar um card marcando que fomos nós que ocultamos
function setHidden(el, hidden) {
  if (hidden) {
    el.style.display = 'none';
    el.dataset.ytsfHidden = 'true';
  } else if (el.dataset.ytsfHidden) {
    el.style.display = '';
    delete el.dataset.ytsfHidden;
  }
}

// Função para mostrar todos os vídeos (quando extensão é desativada)
function showAllVideos() {
  if (!checkExtensionContext()) return;

  // Restaurar feed para original e remover chips
  sortMostViewedActive = false;
  sortMostRecentActive = false;
  restoreOriginalOrder();

  injectedChips.forEach(chip => chip.remove());
  injectedChips = [];

  document.querySelectorAll('[data-ytsf-hidden]').forEach(el => setHidden(el, false));

  // Limpar contador de vídeos ocultos
  hiddenVideos.clear();
  updateBadge();
}

// Função para carregar as configurações
function loadSettings() {
  if (!checkExtensionContext()) return;

  chrome.storage.sync.get(['extensionEnabled', 'keywords', 'videoAge', 'hideWatched', 'channelLimit', 'hidePlaylists', 'enableAltClick', 'sortMostViewedActive', 'sortMostRecentActive', 'hideAdvancedDiscovery', 'hideDuplicates'], function(result) {
    if (!checkExtensionContext()) return;
    isExtensionEnabled = result.extensionEnabled !== false;
    keywords = result.keywords || [];
    maxVideoAge = typeof result.videoAge !== 'undefined' ? parseInt(result.videoAge) : 3;
    hideWatched = typeof result.hideWatched !== 'undefined' ? !!result.hideWatched : true;
    channelLimit = typeof result.channelLimit !== 'undefined' ? parseInt(result.channelLimit) : 2;
    hidePlaylists = typeof result.hidePlaylists !== 'undefined' ? !!result.hidePlaylists : true;
    enableAltClick = typeof result.enableAltClick !== 'undefined' ? !!result.enableAltClick : true;
    hideAdvancedDiscovery = typeof result.hideAdvancedDiscovery !== 'undefined' ? !!result.hideAdvancedDiscovery : true;
    hideDuplicates = typeof result.hideDuplicates !== 'undefined' ? !!result.hideDuplicates : true;
    sortMostViewedActive = !!result.sortMostViewedActive;
    sortMostRecentActive = !!result.sortMostRecentActive;
    settingsLoaded = true;

    if (isExtensionEnabled) {
      // Chips já injetados podem estar mostrando um estado antigo
      if (injectedChips.length === 2) {
        updateChipUI(injectedChips[0], sortMostViewedActive);
        updateChipUI(injectedChips[1], sortMostRecentActive);
      }
      hideVideos();
    } else {
      showAllVideos();
    }
  });
}

// Função para ocultar/mostrar a seção "Descoberta avançada de novos temas"
function applyAdvancedDiscoveryVisibility() {
  const sections = document.querySelectorAll('ytd-chips-shelf-with-video-shelf-renderer');
  sections.forEach(section => {
    // Subir até o ytd-rich-section-renderer pai para ocultar o bloco inteiro
    const richSection = section.closest('ytd-rich-section-renderer');
    setHidden(richSection || section, hideAdvancedDiscovery);
  });
}

// Função para verificar se o título do vídeo contém alguma palavra-chave
function hasKeyword(title) {
  const lower = title.toLowerCase();
  return keywords.some(keyword => lower.includes(keyword.toLowerCase()));
}

// Função para extrair o ID do vídeo da URL
function getVideoId(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url, window.location.origin);
    return urlObj.searchParams.get('v');
  } catch (e) {
    const match = url.match(/[?&]v=([^&#]+)/);
    return match ? match[1] : null;
  }
}

// Texto de idade: "há 3 dias", "há 22 min.", "há 2 sem.", "Transmitido há 4 h", "3 days ago", "Streamed 1 year ago"
const AGE_REGEX = /(\d+)\s*(segundos?|seg|minutos?|min|horas?|h|dias?|semanas?|sem|m[êe]s|meses|anos?|seconds?|sec|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mo|years?|yrs?)\.?(?![a-zà-ÿ])/i;

function isAgeText(text) {
  return /(^|\s)(há|ago|atrás)(\s|$)/i.test(text) && AGE_REGEX.test(text);
}

// Função para analisar a idade em minutos
function parseAgeToMinutes(ageText) {
  const match = (ageText || '').match(AGE_REGEX);
  if (!match) return Infinity;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  if (unit.startsWith('seg') || unit.startsWith('sec')) return num / 60;
  if (unit.startsWith('min')) return num;
  if (unit === 'h' || unit.startsWith('hora') || unit.startsWith('hour') || unit.startsWith('hr')) return num * 60;
  if (unit.startsWith('dia') || unit.startsWith('day')) return num * 1440;
  if (unit.startsWith('sem') || unit.startsWith('w')) return num * 10080;
  if (unit.startsWith('m')) return num * 43200; // mês, meses, month(s), mo
  return num * 525600; // ano(s), year(s), yr
}

// Função para extrair a idade do vídeo em anos
function getVideoAge(ageText) {
  const minutes = parseAgeToMinutes(ageText);
  return minutes === Infinity ? 0 : Math.floor(minutes / 525600);
}

// Visualizações: "6,4 mil", "1,2 mi de visualizações", "1.234 visualizações", "12 mil assistindo", "1.2M views"
const VIEWS_REGEX = /^(\d[\d.,]*)\s*(mil|mi|bi|k|m|b)?\.?(\s+(de\s+)?(visualiza\S*|views?|assistindo|watching|esperando|waiting))?$/i;

function isViewsText(text) {
  const t = text.trim();
  return VIEWS_REGEX.test(t) && !isAgeText(t);
}

// Função para analisar o número de visualizações
function parseViews(text) {
  const match = (text || '').trim().match(VIEWS_REGEX);
  if (!match) return 0;
  const suffix = (match[2] || '').toLowerCase();
  if (!suffix) return parseInt(match[1].replace(/[.,]/g, '')) || 0;
  const num = parseFloat(match[1].replace(',', '.')) || 0;
  if (suffix === 'mil' || suffix === 'k') return num * 1e3;
  if (suffix === 'mi' || suffix === 'm') return num * 1e6;
  return num * 1e9;
}

// Função para obter visualizações e idade de um vídeo
function getVideoMetadata(video) {
  let viewsText = '';
  let ageText = '';
  video.querySelectorAll(METADATA_TEXT_SELECTOR).forEach(item => {
    const txt = (item.textContent || '').replace(/\s+/g, ' ').trim();
    if (!ageText && isAgeText(txt)) ageText = txt;
    else if (!viewsText && isViewsText(txt)) viewsText = txt;
  });
  return { viewsText, ageText };
}

// Função para atualizar visualmente o chip
function updateChipUI(chip, active) {
  const button = chip.querySelector('button');
  const innerDiv = chip.querySelector('.ytChipShapeChip');

  if (active) {
    chip.setAttribute('selected', '');
    chip.classList.add('iron-selected');
    if (button) button.setAttribute('aria-selected', 'true');
    if (innerDiv) {
      innerDiv.classList.remove('ytChipShapeInactive');
      innerDiv.classList.add('ytChipShapeActive');
    }
  } else {
    chip.removeAttribute('selected');
    chip.classList.remove('iron-selected');
    if (button) button.setAttribute('aria-selected', 'false');
    if (innerDiv) {
      innerDiv.classList.remove('ytChipShapeActive');
      innerDiv.classList.add('ytChipShapeInactive');
    }
  }
}

// Função para encontrar o container de chips da página ativa
function findChipsContainer() {
  const hosts = document.querySelectorAll('ytd-feed-filter-chip-bar-renderer');
  for (const host of hosts) {
    if (!isInActivePage(host)) continue;
    const chips = (host.shadowRoot && host.shadowRoot.querySelector('#chips')) || host.querySelector('#chips');
    if (chips) return chips;
  }
  return null;
}

// Injetar CSS para garantir visual dos chips
function injectStyles(targetRoot) {
  const styleId = 'yt-smart-filter-styles';

  // Se o rootNode for o documento inteiro, anexar na head
  let target = targetRoot;
  if (targetRoot === document) {
    target = document.head || document.documentElement;
  }

  // Reaproveita o <style> existente, mas sempre reescreve o conteúdo (uma versão antiga pode ter deixado CSS velho)
  const style = (target.querySelector && target.querySelector('#' + styleId)) || document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Chips no estilo nativo do YouTube, com ícone e estado ativo discreto */
    .yt-smart-filter-chip {
      margin-right: 12px;
      display: inline-block;
      vertical-align: middle;
    }
    .yt-smart-filter-chip button {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      cursor: pointer;
    }
    .yt-smart-filter-chip .ytChipShapeChip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px 0 10px;
      border-radius: 8px;
      font-family: "Roboto", "Arial", sans-serif;
      font-size: 1.4rem;
      font-weight: 500;
      line-height: 2rem;
      white-space: nowrap;
      background-color: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.05)) !important;
      color: var(--yt-spec-text-primary, #0f0f0f) !important;
      border: 0 !important;
      transition: background-color .2s ease, color .2s ease;
    }
    .yt-smart-filter-chip .ytChipShapeChip.ytChipShapeInactive:hover {
      background-color: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.1)) !important;
    }
    .yt-smart-filter-chip .ytChipShapeChip.ytChipShapeActive {
      background-color: var(--yt-spec-text-primary, #0f0f0f) !important;
      color: var(--yt-spec-text-primary-inverse, #fff) !important;
    }
    .yt-smart-filter-chip button:focus-visible .ytChipShapeChip {
      outline: 2px solid var(--yt-spec-call-to-action, #065fd4);
      outline-offset: 2px;
    }
    .yt-smart-filter-chip .ytsf-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      fill: none;
      stroke: currentColor !important;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* Extensões de tema escuro (ex.: Dark Reader) pintam o fundo do texto */
    .yt-smart-filter-chip .ytChipShapeChip div {
      color: inherit !important;
      background: transparent !important;
    }
  `;
  target.appendChild(style);
}

// Ícones dos chips (traço, herdam a cor do texto)
const CHIP_ICONS = {
  views: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  recent: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};

// Criar elemento de chip
function createChip(id, text, icon, onClick) {
  const chip = document.createElement('div');
  chip.className = 'style-scope ytd-feed-filter-chip-bar-renderer yt-smart-filter-chip yt-chip-cloud-chip-renderer';
  chip.id = id;
  chip.setAttribute('chip-style', 'STYLE_HOME_FILTER');

  chip.innerHTML = `
    <div id="chip-shape-container" class="style-scope yt-chip-cloud-chip-renderer">
      <div class="ytChipShapeHost chip-shape">
        <button class="ytChipShapeButtonReset" role="tab" aria-selected="false" title="Ordenar: ${text}">
          <div class="ytChipShapeChip ytChipShapeInactive">
            <svg class="ytsf-icon" viewBox="0 0 24 24" aria-hidden="true">${CHIP_ICONS[icon]}</svg>
            <div>${text}</div>
          </div>
        </button>
      </div>
    </div>
  `;
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(chip);
  });

  return chip;
}

// Injetar os botões na página
function injectFilterChips() {
  if (!isExtensionEnabled || !settingsLoaded) return;

  // Se os chips já estiverem conectados no DOM, não fazer nada
  if (areChipsConnected()) return;

  const parent = findChipsContainer();
  if (!parent) return;

  // Remover restos de uma injeção anterior (ex.: YouTube re-renderizou só parte da barra)
  injectedChips.forEach(chip => chip.remove());
  parent.querySelectorAll('.yt-smart-filter-chip').forEach(chip => chip.remove());

  // Injetar estilos no root correspondente (documento ou shadow root)
  injectStyles(parent.getRootNode());

  const mostViewed = createChip('chip-most-viewed', 'Mais vistos', 'views', (chip) => {
    sortMostViewedActive = !sortMostViewedActive;
    chrome.storage.sync.set({ sortMostViewedActive: sortMostViewedActive });
    updateChipUI(chip, sortMostViewedActive);
    applyFeedSorting();
  });

  const mostRecent = createChip('chip-most-recent', 'Mais recentes', 'recent', (chip) => {
    sortMostRecentActive = !sortMostRecentActive;
    chrome.storage.sync.set({ sortMostRecentActive: sortMostRecentActive });
    updateChipUI(chip, sortMostRecentActive);
    applyFeedSorting();
  });

  safeObserve(() => {
    parent.insertBefore(mostRecent, parent.firstChild);
    parent.insertBefore(mostViewed, parent.firstChild);
  });

  updateChipUI(mostViewed, sortMostViewedActive);
  updateChipUI(mostRecent, sortMostRecentActive);

  injectedChips = [mostViewed, mostRecent];
}

// Função para temporariamente pausar o MutationObserver
function safeObserve(action) {
  if (typeof observer !== 'undefined' && observer) {
    observer.disconnect();
  }
  action();
  if (typeof observer !== 'undefined' && observer) {
    startObserver();
  }
}

// Colocar os cards nas posições ("slots") que os mesmos cards ocupavam, na nova ordem.
// Mantém seções, prateleiras e o item de "carregar mais" do YouTube onde estavam.
function placeInSlots(cardsInDomOrder, newOrder) {
  safeObserve(() => {
    const markers = cardsInDomOrder.map(card => {
      const marker = document.createComment('ytsf-slot');
      card.parentNode.insertBefore(marker, card);
      return marker;
    });
    markers.forEach((marker, i) => {
      marker.parentNode.insertBefore(newOrder[i], marker);
      marker.remove();
    });
  });
}

// Cards carregados (com título e link) da página ativa, em ordem do DOM
function getSortableCards() {
  return Array.from(findVideoElements()).filter(video =>
    video.parentNode && video.querySelector(TITLE_SELECTOR) && video.querySelector(LINK_SELECTOR)
  );
}

// Restaurar ordem original do feed
function restoreOriginalOrder() {
  const cards = getSortableCards().filter(v => v.dataset.originalIndex !== undefined);
  if (cards.length === 0) return;
  const sorted = [...cards].sort((a, b) => parseInt(a.dataset.originalIndex) - parseInt(b.dataset.originalIndex));
  if (sorted.every((card, i) => card === cards[i])) return;
  placeInSlots(cards, sorted);
}

// Aplicar ordenação dos vídeos atuais
function applyFeedSorting() {
  if (!sortMostViewedActive && !sortMostRecentActive) {
    restoreOriginalOrder();
    return;
  }

  const cards = getSortableCards();
  if (cards.length === 0) return;

  // Registrar a posição original dos cards novos (os já registrados mantêm a sua)
  cards.forEach(video => {
    if (video.dataset.originalIndex === undefined) {
      video.dataset.originalIndex = (nextOriginalIndex++).toString();
    }
  });

  const videoData = cards.map(video => {
    const { viewsText, ageText } = getVideoMetadata(video);
    return {
      element: video,
      views: parseViews(viewsText),
      ageMinutes: parseAgeToMinutes(ageText),
      originalIndex: parseInt(video.dataset.originalIndex)
    };
  });

  // Com os dois ativos: a metade mais vista da página vem primeiro; cada metade do mais novo ao mais antigo
  if (sortMostViewedActive && sortMostRecentActive) {
    const byViews = [...videoData].sort((a, b) => b.views - a.views);
    byViews.forEach((d, i) => { d.topViewed = i < Math.ceil(byViews.length / 2); });
  }

  videoData.sort((a, b) => {
    if (sortMostViewedActive && sortMostRecentActive) {
      if (a.topViewed !== b.topViewed) return a.topViewed ? -1 : 1;
    } else if (sortMostViewedActive) {
      if (a.views !== b.views) return b.views - a.views;
    }
    if (sortMostRecentActive) {
      if (a.ageMinutes !== b.ageMinutes) {
        if (a.ageMinutes === Infinity) return 1;
        if (b.ageMinutes === Infinity) return -1;
        return a.ageMinutes - b.ageMinutes;
      }
    }
    return a.originalIndex - b.originalIndex;
  });

  const sorted = videoData.map(d => d.element);
  if (sorted.every((card, i) => card === cards[i])) return;
  placeInSlots(cards, sorted);
}

// Função para atualizar o badge do ícone
function updateBadge() {
  if (!checkExtensionContext()) return;

  const currentCount = hiddenVideos.size;
  // Só atualiza se houver mudança real no número de vídeos
  if (currentCount !== lastHiddenCount) {
    lastHiddenCount = currentCount;
    try {
      chrome.runtime.sendMessage({
        action: "updateBadge",
        count: lastHiddenCount
      });
    } catch (e) {
      console.log('Extensão recarregada, reiniciando...');
      window.location.reload();
    }
  }
}

// Função para salvar vídeos ocultos
function saveHiddenVideos() {
  if (!checkExtensionContext()) return;

  const videosArray = Array.from(hiddenVideos.values());
  chrome.storage.local.set({ hiddenVideos: videosArray }, function() {
    if (!checkExtensionContext()) return;
    updateBadge();
  });
}

// Função para obter identificador único do canal
function getChannelIdentifier(video) {
  const channelLink = video.querySelector('a[href^="/@"], a[href*="/channel/"], a[href*="/user/"]');
  if (channelLink) {
    const href = channelLink.getAttribute('href') || '';
    const match = href.match(/\/(@[^\/?#]+)/) || href.match(/\/channel\/([^\/?#]+)/) || href.match(/\/user\/([^\/?#]+)/);
    return (match ? match[1] : href.split('?')[0]).toLowerCase();
  }

  // Sidebar do /watch: nome do canal é texto, não link
  const channelNameEl = video.querySelector('ytd-channel-name #text, .ytContentMetadataViewModelMetadataRow span.ytAttributedStringHost');
  if (channelNameEl && channelNameEl.textContent.trim()) {
    return channelNameEl.textContent.trim().toLowerCase();
  }

  return null;
}

// Função para verificar se o elemento representa uma playlist ou coleção
function isPlaylistElement(video) {
  const playlistSelectors = [
    'yt-collections-stack',
    '.ytCollectionsStackHost',
    'yt-collection-thumbnail-view-model',
    '.ytCollectionThumbnailViewModelHost',
    '.ytLockupViewModelCollectionStack2',
    'ytd-playlist-thumbnail'
  ];
  if (video.querySelector(playlistSelectors.join(', '))) return true;

  const link = video.querySelector('a.ytLockupViewModelContentImage, a#thumbnail, ' + LINK_SELECTOR);
  const href = link ? link.getAttribute('href') || '' : '';
  return href.includes('list=') || href.includes('/playlist?');
}

// Página do SPA que está visível (o YouTube mantém a home oculta no DOM enquanto se assiste um vídeo)
function isInActivePage(el) {
  const page = el.closest('ytd-browse, ytd-watch-flexy, ytd-search');
  return !page || !page.hasAttribute('hidden');
}

// Função para encontrar os cards de vídeo da página ativa
function findVideoElements() {
  return Array.from(document.querySelectorAll(CARD_SELECTOR)).filter(el =>
    isInActivePage(el) && !el.querySelector('ytd-ad-slot-renderer') && !el.closest('ytd-ad-slot-renderer')
  );
}

// Extrair os dados de um card; null se ainda não carregou
function getCardInfo(video) {
  const titleElement = video.querySelector(TITLE_SELECTOR);
  const linkElement = video.querySelector(LINK_SELECTOR);
  if (!titleElement || !linkElement) return null;

  const url = linkElement.href;
  let videoId = getVideoId(url);
  if (!videoId) {
    try {
      videoId = new URL(url).searchParams.get('list');
    } catch (e) {}
  }

  const { viewsText, ageText } = getVideoMetadata(video);
  return {
    videoId: videoId || url,
    title: (titleElement.textContent || '').trim(),
    url,
    ageText,
    views: parseViews(viewsText),
    channel: getChannelIdentifier(video)
  };
}

// Função para ocultar vídeos.
// Recalcula tudo a cada execução: o YouTube reaproveita os elementos dos cards com outro conteúdo,
// então nenhuma decisão anterior pode ficar "grudada" no elemento.
function hideVideos() {
  if (!checkExtensionContext() || !isExtensionEnabled || !settingsLoaded) return;

  applyAdvancedDiscoveryVisibility();
  injectFilterChips();

  const previousCount = hiddenVideos.size;
  const cards = [];

  findVideoElements().forEach(video => {
    const info = getCardInfo(video);
    if (!info) {
      setHidden(video, false);
      return;
    }

    let reason = '';
    if (hasKeyword(info.title)) {
      reason = 'keyword';
    } else if (maxVideoAge > 0 && getVideoAge(info.ageText) >= maxVideoAge) {
      reason = 'date';
    } else if (hideWatched && video.querySelector(WATCHED_SELECTOR)) {
      reason = 'watched';
    } else if (hidePlaylists && isPlaylistElement(video)) {
      reason = 'playlist';
    }
    cards.push({ video, info, reason });
  });

  // Duplicatas: manter apenas o primeiro card visível de cada vídeo
  if (hideDuplicates) {
    const seen = new Set();
    cards.forEach(card => {
      if (card.reason) return;
      if (seen.has(card.info.videoId)) card.reason = 'duplicate';
      seen.add(card.info.videoId);
    });
  }

  // Limite por canal: entre os que sobraram, manter os N mais vistos de cada canal
  if (channelLimit > 0) {
    const byChannel = new Map();
    cards.forEach(card => {
      if (card.reason || !card.info.channel) return;
      if (!byChannel.has(card.info.channel)) byChannel.set(card.info.channel, []);
      byChannel.get(card.info.channel).push(card);
    });
    byChannel.forEach(items => {
      if (items.length <= channelLimit) return;
      items.sort((a, b) => b.info.views - a.info.views);
      items.slice(channelLimit).forEach(card => { card.reason = 'channelLimit'; });
    });
  }

  cards.forEach(({ video, info, reason }) => {
    setHidden(video, !!reason);
    // Duplicatas não entram nas estatísticas (o vídeo continua visível em outro card)
    if (reason && reason !== 'duplicate' && !hiddenVideos.has(info.videoId)) {
      hiddenVideos.set(info.videoId, {
        title: info.title,
        url: info.url,
        thumbnail: getVideoId(info.url) ? `https://i.ytimg.com/vi/${getVideoId(info.url)}/hqdefault.jpg` : '',
        timestamp: new Date().toISOString(),
        age: info.ageText,
        reason: reason
      });
    }
  });

  if (sortMostViewedActive || sortMostRecentActive) {
    applyFeedSorting();
  }

  if (hiddenVideos.size !== previousCount) {
    saveHiddenVideos();
  }
}

// Throttle: o YouTube gera mutações o tempo todo; roda no máximo a cada 150ms
let hideVideosTimeout = null;
function scheduleHideVideos() {
  if (hideVideosTimeout) return;
  hideVideosTimeout = setTimeout(() => {
    hideVideosTimeout = null;
    hideVideos();
  }, 150);
}

// Observador: qualquer mudança dentro de um card (inclusive reaproveitamento com outro vídeo) ou novos cards
const RELEVANT_SELECTOR = CARD_SELECTOR + ', yt-lockup-view-model, ytd-feed-filter-chip-bar-renderer, ytd-chips-shelf-with-video-shelf-renderer';
let observer = new MutationObserver(function(mutations) {
  if (!checkExtensionContext()) {
    observer.disconnect();
    return;
  }
  if (!isExtensionEnabled) return;

  const relevant = mutations.some(mutation => {
    const target = mutation.target;
    if (target.nodeType === Node.ELEMENT_NODE && target.closest(RELEVANT_SELECTOR)) return true;
    return Array.from(mutation.addedNodes).some(node =>
      node.nodeType === Node.ELEMENT_NODE && (node.matches(RELEVANT_SELECTOR) || node.querySelector(RELEVANT_SELECTOR))
    );
  });

  if (relevant) scheduleHideVideos();
});

function startObserver() {
  observer.observe(document.body, { childList: true, subtree: true });
}

startObserver();

// Carregar configurações e processar
loadSettings();

// Navegação SPA: reprocessar quando a página ativa muda
document.addEventListener('yt-navigate-finish', scheduleHideVideos);
document.addEventListener('yt-page-data-updated', scheduleHideVideos);

// Listener para atualização de palavras-chave e mudança de estado
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (!checkExtensionContext()) return;
  
  if (request.action === "updateKeywords") {
    console.log('[YT Smart Filter] Recebida atualização de palavras-chave');
    if (isExtensionEnabled) {
      loadSettings();
    }
  }
  
  if (request.action === "extensionStateChanged") {
    console.log('[YT Smart Filter] Estado da extensão mudou:', request.enabled);
    isExtensionEnabled = request.enabled;
    
    if (isExtensionEnabled) {
      // Reativar a extensão
      loadSettings();
      hideVideos();
    } else {
      // Desativar a extensão
      showAllVideos();
    }
  }
});

// Interceptar mousedown, mouseup, pointerdown, pointerup e click com ALT para evitar qualquer navegação no YT
const preventAltEvents = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
preventAltEvents.forEach(eventType => {
  document.addEventListener(eventType, function(e) {
    if (!isExtensionEnabled || !enableAltClick) return;
    if (e.altKey) {
      const targetCard = e.target.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, yt-lockup-view-model, ytd-video-preview');
      if (targetCard) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);
});

// Listener principal para processar o Alt+Click nos vídeos
document.addEventListener('click', function(e) {
  if (!isExtensionEnabled || !enableAltClick) return;
  
  if (e.altKey) {
    // 1. Tentar encontrar o card real diretamente subindo na árvore do DOM
    let videoCard = e.target.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, yt-lockup-view-model');
    
    // 2. Se não encontrou diretamente, verifica se o clique foi em um preview flutuante
    if (!videoCard) {
      const previewEl = e.target.closest('ytd-video-preview');
      if (previewEl) {
        const link = previewEl.querySelector('a[href*="/watch?v="], a[href*="list="], a[href*="/playlist?"]');
        if (link) {
          const href = link.getAttribute('href') || '';
          let videoId = getVideoId(href);
          if (!videoId && href.includes('list=')) {
            const urlObj = new URL(href, window.location.origin);
            videoId = urlObj.searchParams.get('list') || urlObj.searchParams.get('v');
          }
          if (videoId) {
            const cards = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, yt-lockup-view-model');
            for (const card of cards) {
              const cardLink = card.querySelector('a[href*="/watch?v="], a[href*="list="], a[href*="/playlist?"]');
              if (cardLink) {
                const cardHref = cardLink.getAttribute('href') || '';
                if (cardHref.includes(videoId)) {
                  videoCard = card;
                  break;
                }
              }
            }
          } else {
            // Fallback: tentar comparar por título caso não haja ID claro
            const titleEl = previewEl.querySelector('.ytp-title-link, [class*="title" i]');
            if (titleEl && titleEl.textContent) {
              const previewTitle = titleEl.textContent.trim().toLowerCase();
              const cards = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, yt-lockup-view-model');
              for (const card of cards) {
                const cardTitleEl = card.querySelector('[class*="title" i], h3, h4');
                if (cardTitleEl && cardTitleEl.textContent && cardTitleEl.textContent.trim().toLowerCase().includes(previewTitle)) {
                  videoCard = card;
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    if (videoCard) {
      e.preventDefault();
      e.stopPropagation();
      
      // Desativar eventos de ponteiro no card temporariamente para o navegador registrar que o mouse "saiu" do card
      videoCard.style.pointerEvents = 'none';
      setTimeout(() => {
        videoCard.style.pointerEvents = '';
      }, 600);
      
      // Cancelar hover/preview simulando a saída do mouse
      const resetHover = (el) => {
        if (!el) return;
        const events = ['mouseleave', 'mouseout', 'pointerout', 'pointerleave'];
        events.forEach(evt => {
          el.dispatchEvent(new MouseEvent(evt, { bubbles: true }));
          try {
            el.dispatchEvent(new PointerEvent(evt, { bubbles: true }));
          } catch (pe) {}
        });
      };
      
      resetHover(videoCard);
      const thumb = videoCard.querySelector('ytd-thumbnail, yt-thumbnail-view-model, a');
      if (thumb) {
        resetHover(thumb);
      }
      
      // Ocultar e parar o preview flutuante global do YouTube
      const globalPreview = document.querySelector('ytd-video-preview');
      if (globalPreview) {
        resetHover(globalPreview);
        globalPreview.style.display = 'none';
        
        const previewVideos = globalPreview.querySelectorAll('video');
        previewVideos.forEach(v => {
          try {
            v.pause();
            v.src = "";
            v.load();
          } catch (err) {}
        });
        
        // Só restaurar o display quando o usuário mover o mouse
        const restorePreview = () => {
          globalPreview.style.display = '';
          document.removeEventListener('mousemove', restorePreview);
        };
        // Pequeno delay antes de adicionar o listener para ignorar o tremor do clique
        setTimeout(() => {
          document.addEventListener('mousemove', restorePreview);
        }, 300);
      }
      
      // Forçar parada de qualquer vídeo de preview rodando no card em si
      const cardVideos = videoCard.querySelectorAll('video');
      cardVideos.forEach(v => {
        try {
          v.pause();
          v.src = "";
          v.load();
        } catch (err) {}
      });
      
      const menuButton = videoCard.querySelector(
        '.ytLockupMetadataViewModelMenuButton button, ' +
        'button[aria-label*="ações" i], ' +
        'button[aria-label*="actions" i], ' +
        'button[aria-label*="menu" i], ' +
        '#menu button'
      );
      
      if (menuButton) {
        // Esconder os popups/dropdowns do YT temporariamente para evitar piscadas na tela
        let styleEl = document.getElementById('yt-hide-popups-style');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'yt-hide-popups-style';
          styleEl.textContent = 'ytd-popup-container, tp-yt-iron-dropdown, .ytd-popup-container { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }';
          document.documentElement.appendChild(styleEl);
        }

        const removeHideStyle = () => {
          const style = document.getElementById('yt-hide-popups-style');
          if (style) style.remove();
        };

        menuButton.click();
        
        const start = Date.now();
        const interval = setInterval(() => {
          const items = document.querySelectorAll('yt-list-item-view-model, ytd-menu-service-item-renderer');
          let targetItem = null;
          for (const item of items) {
            const text = item.textContent || '';
            if (text.includes('Não tenho interesse') || text.includes('Not interested')) {
              targetItem = item;
              break;
            }
          }
          
          if (targetItem) {
            clearInterval(interval);
            const clickable = targetItem.querySelector('button, [role="button"]') || targetItem;
            clickable.click();
            
            // Restaurar visualização normal após uma pequena fração de segundo
            setTimeout(removeHideStyle, 50);
          } else if (Date.now() - start > 1000) {
            clearInterval(interval);
            removeHideStyle();
            console.log('[YT Smart Filter] Não foi possível encontrar o botão "Não tenho interesse" no menu.');
          }
        }, 20);
      }
    }
  }
}, true); 
