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

// Estado da ordenação
let sortMostViewedActive = false;
let sortMostRecentActive = false;
let injectedChips = [];

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

// Função para verificar se a extensão está ativa
function checkExtensionEnabled() {
  if (!checkExtensionEnabledContext()) return false;
  
  chrome.storage.sync.get(['extensionEnabled'], function(result) {
    isExtensionEnabled = result.extensionEnabled !== false;
    if (isExtensionEnabled) {
      // Se foi reativada, executar a ocultação
      hideVideos();
    } else {
      // Se foi desativada, mostrar todos os vídeos
      showAllVideos();
    }
  });
  
  return isExtensionEnabled;
}

// Função auxiliar para evitar recursão ou erros de nomenclatura
function checkExtensionEnabledContext() {
  try {
    chrome.runtime.getURL('');
    return true;
  } catch (e) {
    isExtensionValid = false;
    return false;
  }
}

// Função para mostrar todos os vídeos (quando extensão é desativada)
function showAllVideos() {
  if (!checkExtensionEnabledContext()) return;
  
  // Restaurar feed para original e remover chips
  sortMostViewedActive = false;
  sortMostRecentActive = false;
  restoreOriginalOrder();
  
  const chipsContainer = findChipsContainer();
  if (chipsContainer) {
    const ourChips = chipsContainer.querySelectorAll('.yt-smart-filter-chip');
    ourChips.forEach(chip => chip.remove());
  }
  
  const videoElements = findVideoElements();
  videoElements.forEach(video => {
    video.style.display = '';
  });
  
  // Limpar contador de vídeos ocultos
  hiddenVideos.clear();
  updateBadge();
}

// Função para carregar as palavras-chave
function loadKeywords() {
  if (!checkExtensionEnabledContext() || !isExtensionEnabled) return;
  
  chrome.storage.sync.get(['keywords'], function(result) {
    if (!checkExtensionEnabledContext()) return;
    keywords = result.keywords || [];
    if (isExtensionEnabled) {
      hideVideos();
    }
  });
}

// Função para carregar as configurações
function loadSettings() {
  if (!checkExtensionEnabledContext() || !isExtensionEnabled) return;
  
  chrome.storage.sync.get(['keywords', 'videoAge', 'hideWatched', 'channelLimit', 'hidePlaylists', 'enableAltClick', 'sortMostViewedActive', 'sortMostRecentActive'], function(result) {
    if (!checkExtensionEnabledContext()) return;
    keywords = result.keywords || [];
    maxVideoAge = typeof result.videoAge !== 'undefined' ? parseInt(result.videoAge) : 3;
    hideWatched = typeof result.hideWatched !== 'undefined' ? !!result.hideWatched : true;
    channelLimit = typeof result.channelLimit !== 'undefined' ? parseInt(result.channelLimit) : 2;
    hidePlaylists = typeof result.hidePlaylists !== 'undefined' ? !!result.hidePlaylists : true;
    enableAltClick = typeof result.enableAltClick !== 'undefined' ? !!result.enableAltClick : true;
    sortMostViewedActive = !!result.sortMostViewedActive;
    sortMostRecentActive = !!result.sortMostRecentActive;
    if (isExtensionEnabled) {
      hideVideos();
    }
  });
}

// Função para verificar se o título do vídeo contém alguma palavra-chave
function shouldHideVideo(title, ageText) {
  if (!isExtensionEnabled) return false;
  
  // Verificar palavras-chave
  const hasKeyword = keywords.some(keyword => 
    title.toLowerCase().includes(keyword.toLowerCase())
  );
  
  // Verificar idade
  const videoAge = getVideoAge(ageText);
  const isTooOld = maxVideoAge > 0 && videoAge >= maxVideoAge;
  
  return hasKeyword || isTooOld;
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

// Função para extrair a idade do vídeo em anos
function getVideoAge(ageText) {
  if (!ageText) return 0;
  
  const text = ageText.toLowerCase();
  if (text.includes('hora') || text.includes('horas')) return 0;
  if (text.includes('dia') || text.includes('dias')) return 0;
  if (text.includes('semana') || text.includes('semanas')) return 0;
  if (text.includes('mês') || text.includes('meses')) return 0;
  
  const match = text.match(/(\d+)\s*ano/);
  if (match) {
    return parseInt(match[1]);
  }
  
  return 0;
}

// Função para analisar o número de visualizações
function parseViews(text) {
  if (!text) return 0;
  text = text.toLowerCase().replace(/[\u00a0\s]/g, ' '); // normalizar espaços
  if (text.includes('nenhuma') || text.includes('no views') || text.includes('sem visualiza')) return 0;
  
  const match = text.match(/([0-9.,\s]+)/);
  if (!match) return 0;
  
  let numStr = match[1].trim().replace(/\s/g, '').replace(',', '.');
  let num = parseFloat(numStr);
  if (isNaN(num)) return 0;
  
  if (text.includes('mil') || text.includes('k')) {
    num *= 1000;
  } else if (text.includes('mi') || text.includes('m') || text.includes('milhão') || text.includes('milões') || text.includes('milhões')) {
    num *= 1000000;
  } else if (text.includes('bi') || text.includes('b') || text.includes('bilhão') || text.includes('bilhões')) {
    num *= 1000000000;
  }
  return num;
}

// Função para analisar a idade em minutos
function parseAgeToMinutes(ageText) {
  if (!ageText) return Infinity;
  const text = ageText.toLowerCase().trim();
  
  const match = text.match(/(\d+)/);
  if (!match) return Infinity;
  const num = parseInt(match[1]);
  
  if (text.includes('segundo')) return num / 60;
  if (text.includes('minuto')) return num;
  if (text.includes('hora')) return num * 60;
  if (text.includes('dia')) return num * 1440;
  if (text.includes('semana')) return num * 10080;
  if (text.includes('mês') || text.includes('meses') || text.includes('month')) return num * 43200;
  if (text.includes('ano') || text.includes('year')) return num * 525600;
  
  // Inglês
  if (text.includes('second')) return num / 60;
  if (text.includes('minute')) return num;
  if (text.includes('hour')) return num * 60;
  if (text.includes('day')) return num * 1440;
  if (text.includes('week')) return num * 10080;
  
  return Infinity;
}

// Função para obter visualizações e idade de um vídeo
function getVideoMetadata(video) {
  let viewsText = '';
  let ageText = '';
  
  const metadataItems = video.querySelectorAll('.ytContentMetadataViewModelMetadataRow span, .yt-content-metadata-view-model-wiz__metadata-text, #metadata-line span');
  metadataItems.forEach(item => {
    const txt = item.textContent || '';
    const lower = txt.toLowerCase();
    if (lower.includes('visualiza') || lower.includes('views') || lower.includes('view') || lower.includes('assistido') || lower.includes('assistida')) {
      viewsText = txt;
    } else if (lower.includes('há') || lower.includes('ago') || lower.includes('hora') || lower.includes('dia') || lower.includes('semana') || lower.includes('mês') || lower.includes('meses') || lower.includes('ano') || lower.includes('minute') || lower.includes('minuto')) {
      ageText = txt;
    }
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

// Função para encontrar o container de chips (mesmo dentro de Shadow DOM)
function findChipsContainer() {
  const host = document.querySelector('ytd-feed-filter-chip-bar-renderer');
  if (!host) return null;
  
  // Tentar encontrar no Shadow DOM do host primeiro
  if (host.shadowRoot) {
    const chips = host.shadowRoot.querySelector('#chips');
    if (chips) return chips;
  }
  
  // Se for Shady DOM ou não estiver no shadowRoot, buscar no light DOM do host
  const chips = host.querySelector('#chips');
  if (chips) return chips;
  
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
  
  if (target.getElementById && target.getElementById(styleId)) return;
  if (target.querySelector && target.querySelector('#' + styleId)) return;
  
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .yt-smart-filter-chip {
      margin-right: 8px;
      display: inline-block;
      vertical-align: middle;
    }
    
    /* Configurações de cores baseadas no tema claro/escuro */
    :host, :root {
      --yt-most-viewed-inactive-bg: rgba(30, 144, 255, 0.15);
      --yt-most-viewed-inactive-text: #63a4ff;
      --yt-most-recent-inactive-bg: rgba(186, 104, 200, 0.15);
      --yt-most-recent-inactive-text: #e1bee7;
    }
    
    html:not([dark]) :host, html:not([dark]) :root, html:not([dark]) {
      --yt-most-viewed-inactive-bg: rgba(0, 120, 255, 0.1) !important;
      --yt-most-viewed-inactive-text: #0056b3 !important;
      --yt-most-recent-inactive-bg: rgba(106, 27, 154, 0.1) !important;
      --yt-most-recent-inactive-text: #6a1b9a !important;
    }

    /* Mais vistos - Inativo */
    #chip-most-viewed .ytChipShapeChip.ytChipShapeInactive {
      background-color: var(--yt-most-viewed-inactive-bg) !important;
      color: var(--yt-most-viewed-inactive-text) !important;
      border: 1px solid rgba(0, 120, 255, 0.25) !important;
    }
    /* Mais vistos - Ativo */
    #chip-most-viewed .ytChipShapeChip.ytChipShapeActive {
      background-color: #1e90ff !important;
      color: #ffffff !important;
      border: 1px solid #1e90ff !important;
    }
    
    /* Mais recentes - Inativo */
    #chip-most-recent .ytChipShapeChip.ytChipShapeInactive {
      background-color: var(--yt-most-recent-inactive-bg) !important;
      color: var(--yt-most-recent-inactive-text) !important;
      border: 1px solid rgba(138, 43, 226, 0.25) !important;
    }
    /* Mais recentes - Ativo */
    #chip-most-recent .ytChipShapeChip.ytChipShapeActive {
      background-color: #8a2be2 !important;
      color: #ffffff !important;
      border: 1px solid #8a2be2 !important;
    }

    .yt-smart-filter-chip .ytChipShapeChip {
      cursor: pointer;
      border-radius: 8px;
      padding: 0 12px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.4rem;
      font-weight: 500;
      transition: background-color 0.5s cubic-bezier(0.05,0,0,1);
    }
    
    /* Garantir que o texto interno herde a cor correta */
    .yt-smart-filter-chip .ytChipShapeChip div {
      color: inherit !important;
    }
  `;
  target.appendChild(style);
}

// Criar elemento de chip
function createChip(id, text, onClick) {
  const chip = document.createElement('div');
  chip.className = 'style-scope ytd-feed-filter-chip-bar-renderer yt-smart-filter-chip yt-chip-cloud-chip-renderer';
  chip.id = id;
  chip.setAttribute('chip-style', 'STYLE_HOME_FILTER');
  
  chip.innerHTML = `
    <div id="chip-shape-container" class="style-scope yt-chip-cloud-chip-renderer">
      <div class="ytChipShapeHost chip-shape">
        <button class="ytChipShapeButtonReset" role="tab" aria-selected="false">
          <div class="ytChipShapeChip ytChipShapeInactive ytChipShapeOnlyTextPadding">
            <div>${text}</div>
            <yt-touch-feedback-shape aria-hidden="true" class="ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeTouchResponse">
              <div class="ytSpecTouchFeedbackShapeStroke" style="border-radius: 8px;"></div>
              <div class="ytSpecTouchFeedbackShapeFill" style="border-radius: 8px;"></div>
            </yt-touch-feedback-shape>
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
  if (!isExtensionEnabled) return;
  
  // Se os chips já estiverem conectados no DOM, não fazer nada
  if (areChipsConnected()) return;
  
  const parent = findChipsContainer();
  if (!parent) return;
  
  // Injetar estilos no root correspondente (documento ou shadow root)
  const rootNode = parent.getRootNode();
  injectStyles(rootNode);
  
  if (parent.querySelector('#chip-most-viewed')) return;
  
  console.log('[YT Smart Filter] Injetando chips de ordenação...');
  
  const mostViewed = createChip('chip-most-viewed', 'Mais vistos', (chip) => {
    sortMostViewedActive = !sortMostViewedActive;
    chrome.storage.sync.set({ sortMostViewedActive: sortMostViewedActive });
    updateChipUI(chip, sortMostViewedActive);
    applyFeedSorting();
  });
  
  const mostRecent = createChip('chip-most-recent', 'Mais recentes', (chip) => {
    sortMostRecentActive = !sortMostRecentActive;
    chrome.storage.sync.set({ sortMostRecentActive: sortMostRecentActive });
    updateChipUI(chip, sortMostRecentActive);
    applyFeedSorting();
  });
  
  parent.insertBefore(mostRecent, parent.firstChild);
  parent.insertBefore(mostViewed, parent.firstChild);
  
  updateChipUI(mostViewed, sortMostViewedActive);
  updateChipUI(mostRecent, sortMostRecentActive);
  
  injectedChips = [mostViewed, mostRecent];
  console.log('[YT Smart Filter] Chips de ordenação injetados com sucesso.');
}

// Função para temporariamente pausar o MutationObserver
function safeObserve(action) {
  if (typeof observer !== 'undefined' && observer) {
    observer.disconnect();
  }
  action();
  if (typeof observer !== 'undefined' && observer) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
  }
}

// Restaurar ordem original do feed
function restoreOriginalOrder() {
  const videos = Array.from(findVideoElements());
  const sorted = [...videos].filter(v => v.dataset.originalIndex !== undefined).sort((a, b) => {
    return parseInt(a.dataset.originalIndex) - parseInt(b.dataset.originalIndex);
  });
  
  if (sorted.length === 0) return;
  
  safeObserve(() => {
    sorted.forEach(video => {
      const parent = video._originalParent;
      const sibling = video._originalNextSibling;
      if (parent) {
        if (sibling && sibling.parentNode === parent) {
          parent.insertBefore(video, sibling);
        } else {
          parent.appendChild(video);
        }
      }
    });
  });
}

// Reordenar os elementos de vídeo no DOM
function reorderVideos(sortedVideos) {
  const parentMap = new Map();
  sortedVideos.forEach(v => {
    const parent = v._originalParent || v.parentElement;
    if (parent) {
      if (!parentMap.has(parent)) {
        parentMap.set(parent, []);
      }
      parentMap.get(parent).push(v);
    }
  });
  
  const parents = Array.from(parentMap.keys());
  parents.sort((a, b) => {
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  
  safeObserve(() => {
    let videoIndex = 0;
    parents.forEach(parent => {
      const originalChildrenCount = parentMap.get(parent).length;
      for (let i = 0; i < originalChildrenCount && videoIndex < sortedVideos.length; i++) {
        parent.appendChild(sortedVideos[videoIndex]);
        videoIndex++;
      }
    });
    
    if (parents.length > 0 && videoIndex < sortedVideos.length) {
      const lastParent = parents[parents.length - 1];
      while (videoIndex < sortedVideos.length) {
        lastParent.appendChild(sortedVideos[videoIndex]);
        videoIndex++;
      }
    }
  });
}

// Aplicar ordenação dos vídeos atuais
function applyFeedSorting() {
  if (!sortMostViewedActive && !sortMostRecentActive) {
    restoreOriginalOrder();
    return;
  }
  
  const allVideos = Array.from(findVideoElements());
  
  // Filtrar apenas vídeos que já têm título/link (carregados) e não estão ocultos (display !== none)
  const videos = allVideos.filter(video => {
    const titleElement = video.querySelector('.yt-lockup-metadata-view-model-wiz__title, .ytLockupMetadataViewModelTitle, #video-title');
    const linkElement = video.querySelector('a[href*="/watch?v="], a[href*="list="], a[href*="/playlist?"]');
    return titleElement && linkElement && video.style.display !== 'none';
  });
  
  if (videos.length === 0) return;
  
  videos.forEach((video, index) => {
    if (video.dataset.originalIndex === undefined) {
      video.dataset.originalIndex = index.toString();
      video._originalParent = video.parentElement;
      video._originalNextSibling = video.nextSibling;
    }
  });
  
  const videoData = videos.map(video => {
    const { viewsText, ageText } = getVideoMetadata(video);
    const views = parseViews(viewsText);
    const ageMinutes = parseAgeToMinutes(ageText);
    return {
      element: video,
      views,
      ageMinutes,
      originalIndex: parseInt(video.dataset.originalIndex)
    };
  });
  
  videoData.sort((a, b) => {
    if (sortMostViewedActive && sortMostRecentActive) {
      const ageHoursA = a.ageMinutes / 60;
      const ageHoursB = b.ageMinutes / 60;
      const scoreA = a.views / (ageHoursA + 2);
      const scoreB = b.views / (ageHoursB + 2);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
    } else if (sortMostViewedActive) {
      if (a.views !== b.views) {
        return b.views - a.views;
      }
    } else if (sortMostRecentActive) {
      if (a.ageMinutes !== b.ageMinutes) {
        return a.ageMinutes - b.ageMinutes;
      }
    }
    return a.originalIndex - b.originalIndex;
  });
  
  const sortedElements = videoData.map(d => d.element);
  reorderVideos(sortedElements);
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

// Função para carregar a thumbnail
function loadThumbnail(videoId) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.src);
    img.onerror = () => resolve(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  });
}

// Função para obter identificador único do canal
function getChannelIdentifier(video) {
  // Estratégia 1: Buscar links com /@ ou /channel/ ou /user/
  const channelLink = video.querySelector('a[href*="/@"], a[href*="/channel/"], a[href*="/user/"]');
  if (channelLink) {
    const href = channelLink.getAttribute('href') || '';
    const match = href.match(/\/(@[^\/?#]+)/) || href.match(/\/channel\/([^\/?#]+)/) || href.match(/\/user\/([^\/?#]+)/);
    if (match) {
      return match[1].toLowerCase();
    }
    return href.split('?')[0].toLowerCase();
  }
  
  // Estratégia 2: Fallback para ytd-channel-name ou similar
  const channelNameEl = video.querySelector('ytd-channel-name, [class*="channel-name"]');
  if (channelNameEl && channelNameEl.textContent) {
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
    'ytd-playlist-thumbnail',
    '[class*="playlist-thumbnail"]'
  ];
  for (const selector of playlistSelectors) {
    if (video.querySelector(selector)) {
      return true;
    }
  }
  
  const links = video.querySelectorAll('a');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (href.includes('list=') || href.includes('/playlist?')) {
      return true;
    }
  }
  
  return false;
}

// Função para processar um vídeo
async function processVideo(video, currentChannelCounts) {
  if (!checkExtensionContext()) return;

  // Múltiplas estratégias para encontrar o título e link
  let titleElement = video.querySelector('.yt-lockup-metadata-view-model-wiz__title, .ytLockupMetadataViewModelTitle, #video-title');
  let linkElement = video.querySelector('a[href*="/watch?v="], a[href*="list="], a[href*="/playlist?"]');
  
  // Fallback para outras estruturas
  if (!titleElement) {
    titleElement = video.querySelector('[class*="title" i], [class*="heading" i], h3, h4');
  }
  
  if (!linkElement) {
    linkElement = video.querySelector('a[href*="/watch?v="]');
  }
  
  if (!linkElement) {
    linkElement = video.querySelector('a[href*="list="], a[href*="/playlist?"]');
  }
  
  if (titleElement && linkElement) {
    // Buscar o elemento correto de idade - múltiplas estratégias
    let ageText = '';
    
    // Estratégia 1: Metadados padrão
    let metadataItems = video.querySelectorAll('.yt-content-metadata-view-model-wiz__metadata-text');
    
    // Estratégia 2: Fallback para outras estruturas
    if (metadataItems.length === 0) {
      metadataItems = video.querySelectorAll('[class*="metadata" i], [class*="info" i], span, div');
    }
    
    metadataItems.forEach(item => {
      const txt = item.textContent.toLowerCase();
      if (txt.includes('ano') || txt.includes('mês') || txt.includes('meses') || txt.includes('semana') || txt.includes('semanas') || txt.includes('dia') || txt.includes('dias') || txt.includes('hora') || txt.includes('horas')) {
        ageText = item.textContent;
      }
    });
    
    const title = titleElement.textContent || titleElement.innerText || '';
    const url = linkElement.href;
    let videoId = getVideoId(url);
    if (!videoId && url.includes('list=')) {
      const urlObj = new URL(url);
      videoId = urlObj.searchParams.get('list') || urlObj.searchParams.get('v');
    }
    if (!videoId) {
      videoId = btoa(url).replace(/[^a-zA-Z0-9]/g, '');
    }

    // Verificar se o vídeo tem barra de progresso (assistido) - múltiplas estratégias
    let isWatched = false;
    if (hideWatched) {
      // Múltiplos seletores para vídeos assistidos
      const watchedSelectors = [
        '.ytThumbnailOverlayProgressBarHostWatchedProgressBar',
        '[class*="progress"]',
        '[class*="watched"]',
        '[class*="resume"]'
      ];
      
      for (const selector of watchedSelectors) {
        if (video.querySelector(selector)) {
          isWatched = true;
          break;
        }
      }
    }

    let reason = '';
    if (shouldHideVideo(title, ageText)) {
      if (maxVideoAge > 0 && getVideoAge(ageText) >= maxVideoAge) {
        reason = 'date';
      } else {
        reason = 'keyword';
      }
    } else if (isWatched) {
      reason = 'watched';
    } else if (hidePlaylists && isPlaylistElement(video)) {
      reason = 'playlist';
    } else if (channelLimit > 0) {
      const channelId = getChannelIdentifier(video);
      if (channelId) {
        const currentCount = currentChannelCounts.get(channelId) || 0;
        if (currentCount >= channelLimit) {
          reason = 'channelLimit';
        } else {
          currentChannelCounts.set(channelId, currentCount + 1);
        }
      }
    }

    if (reason) {
      // Verifica se o vídeo já está na lista
      if (!hiddenVideos.has(videoId)) {
        // Carregar thumbnail antes de ocultar
        const thumbnailUrl = await loadThumbnail(videoId);
        if (!checkExtensionContext()) return;
        // Adicionar à lista de vídeos ocultos usando o ID como chave
        hiddenVideos.set(videoId, {
          title: title,
          url: url,
          thumbnail: thumbnailUrl,
          timestamp: new Date().toISOString(),
          age: ageText,
          reason: reason
        });
      }
      video.style.display = 'none';
    } else {
      video.style.display = '';
    }
  }
}

// Função para encontrar vídeos usando múltiplas estratégias
function findVideoElements() {
  // Estratégia 1: Seletores principais
  let elements = document.querySelectorAll('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer');
  
  // Estratégia 2: Se não encontrar nada, tentar seletores mais genéricos
  if (elements.length === 0) {
    elements = document.querySelectorAll('[class*="ytd-rich-item-renderer"], [class*="ytd-compact-video-renderer"], [class*="ytd-video-renderer"]');
  }
  
  // Estratégia 3: Buscar por elementos que contenham thumbnails do YT
  if (elements.length === 0) {
    elements = document.querySelectorAll('a[href*="/watch?v="]');
    // Filtrar apenas elementos que parecem ser vídeos
    elements = Array.from(elements).filter(el => {
      const parent = el.closest('[class*="renderer"]') || el.closest('[class*="item"]');
      return parent && parent.querySelector('img[src*="i.ytimg.com"]');
    });
  }
  
  return elements;
}

// Função para ocultar vídeos
async function hideVideos() {
  if (!checkExtensionContext() || !isExtensionEnabled) return;
  
  // Tentar injetar os chips de ordenação
  injectFilterChips();
  
  const videoElements = findVideoElements();
  const previousCount = hiddenVideos.size;
  
  // Log para debug
  console.log(`[YT Smart Filter] Encontrados ${videoElements.length} vídeos para processar`);
  
  // Processar todos os vídeos sequencialmente
  const currentChannelCounts = new Map();
  for (const video of videoElements) {
    await processVideo(video, currentChannelCounts);
  }
  
  // Re-aplicar ordenação se estiver ativa
  if (sortMostViewedActive || sortMostRecentActive) {
    applyFeedSorting();
  }
  
  // Só salva se houver mudança real na lista
  if (hiddenVideos.size !== previousCount) {
    console.log(`[YT Smart Filter] Ocultados ${hiddenVideos.size} vídeos (${hiddenVideos.size - previousCount} novos)`);
    saveHiddenVideos();
  }
}

// Observador para detectar mudanças na página - melhorado
let observer = new MutationObserver(function(mutations) {
  if (!checkExtensionContext()) {
    observer.disconnect();
    return;
  }
  
  // Garantir que os chips estão lá se o container de chips existir
  if (!areChipsConnected()) {
    injectFilterChips();
  }
  
  // Verificar se há mudanças relevantes
  let hasRelevantChanges = false;
  mutations.forEach(mutation => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Verificar se algum dos nós adicionados parece ser um vídeo
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches && (node.matches('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer') || 
              node.querySelector('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer'))) {
            hasRelevantChanges = true;
          }
        }
      });
    }
  });
  
  if (hasRelevantChanges) {
    console.log('[YT Smart Filter] Mudanças detectadas na página, processando vídeos...');
    // Usar debounce para evitar múltiplas execuções
    clearTimeout(window.hideVideosTimeout);
    window.hideVideosTimeout = setTimeout(hideVideos, 100);
  }
});

// Iniciar observador com configuração mais específica
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false
});

// Função para inicializar a extensão
function initializeExtension() {
  console.log('[YT Smart Filter] Inicializando extensão...');
  
  // Verificar estado inicial da extensão
  checkExtensionEnabled();
  
  // Aguardar um pouco para a página carregar completamente
  setTimeout(() => {
    if (document.readyState === 'complete') {
      if (isExtensionEnabled) {
        loadSettings();
        hideVideos();
      }
    } else {
      window.addEventListener('load', () => {
        if (isExtensionEnabled) {
          loadSettings();
          hideVideos();
        }
      });
    }
  }, 1000);
  
  // Também executar quando a URL mudar (navegação SPA)
  let currentUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      console.log('[YT Smart Filter] URL mudou, reprocessando...');
      if (isExtensionEnabled) {
        setTimeout(hideVideos, 500);
      }
    }
  }, 1000);
}

// Carregar palavras-chave iniciais
loadKeywords();

// Carregar configurações iniciais
loadSettings();

// Inicializar extensão
initializeExtension();

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