let keywords = [];
let hiddenVideos = new Map(); // Mudando para Map para evitar duplicatas
let isExtensionValid = true;
let lastHiddenCount = 0;
let maxVideoAge = 0; // Idade máxima dos vídeos em anos
let hideWatched = false; // Ocultar vídeos assistidos
let isExtensionEnabled = true; // Estado da extensão

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
  if (!checkExtensionContext()) return false;
  
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

// Função para mostrar todos os vídeos (quando extensão é desativada)
function showAllVideos() {
  if (!checkExtensionContext()) return;
  
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
  if (!checkExtensionContext() || !isExtensionEnabled) return;
  
  chrome.storage.sync.get(['keywords'], function(result) {
    if (!checkExtensionContext()) return;
    keywords = result.keywords || [];
    if (isExtensionEnabled) {
      hideVideos();
    }
  });
}

// Função para carregar as configurações
function loadSettings() {
  if (!checkExtensionContext() || !isExtensionEnabled) return;
  
  chrome.storage.sync.get(['keywords', 'videoAge', 'hideWatched'], function(result) {
    if (!checkExtensionContext()) return;
    keywords = result.keywords || [];
    maxVideoAge = parseInt(result.videoAge || '0');
    hideWatched = !!result.hideWatched;
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
  const urlObj = new URL(url);
  return urlObj.searchParams.get('v');
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

// Função para processar um vídeo
async function processVideo(video) {
  if (!checkExtensionContext()) return;

  // Múltiplas estratégias para encontrar o título e link
  let titleElement = video.querySelector('.yt-lockup-metadata-view-model-wiz__title');
  let linkElement = video.querySelector('.yt-lockup-metadata-view-model-wiz__title');
  
  // Fallback para outras estruturas
  if (!titleElement) {
    titleElement = video.querySelector('[class*="title"], [class*="heading"], h3, h4');
  }
  
  if (!linkElement) {
    linkElement = video.querySelector('a[href*="/watch?v="]');
  }
  
  if (titleElement && linkElement) {
    // Buscar o elemento correto de idade - múltiplas estratégias
    let ageText = '';
    
    // Estratégia 1: Metadados padrão
    let metadataItems = video.querySelectorAll('.yt-content-metadata-view-model-wiz__metadata-text');
    
    // Estratégia 2: Fallback para outras estruturas
    if (metadataItems.length === 0) {
      metadataItems = video.querySelectorAll('[class*="metadata"], [class*="info"], span, div');
    }
    
    metadataItems.forEach(item => {
      const txt = item.textContent.toLowerCase();
      if (txt.includes('ano') || txt.includes('mês') || txt.includes('meses') || txt.includes('semana') || txt.includes('semanas') || txt.includes('dia') || txt.includes('dias') || txt.includes('hora') || txt.includes('horas')) {
        ageText = item.textContent;
      }
    });
    
    const title = titleElement.textContent || titleElement.innerText || '';
    const url = linkElement.href;
    const videoId = getVideoId(url);

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
    }

    if ((shouldHideVideo(title, ageText) || isWatched) && reason) {
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
  
  const videoElements = findVideoElements();
  const previousCount = hiddenVideos.size;
  
  // Log para debug
  console.log(`[YT Smart Filter] Encontrados ${videoElements.length} vídeos para processar`);
  
  // Processar todos os vídeos em paralelo
  await Promise.all(Array.from(videoElements).map(processVideo));
  
  // Só salva se houver mudança real na lista
  if (hiddenVideos.size !== previousCount) {
    console.log(`[YT Smart Filter] Ocultados ${hiddenVideos.size} vídeos (${hiddenVideos.size - previousCount} novos)`);
    saveHiddenVideos();
  }
}

// Observador para detectar mudanças na página - melhorado
const observer = new MutationObserver(function(mutations) {
  if (!checkExtensionContext()) {
    observer.disconnect();
    return;
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