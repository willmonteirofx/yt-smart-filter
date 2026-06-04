// Função para atualizar o badge
function updateBadge(count, isEnabled = true) {
  if (!isEnabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#6c757d' });
    return;
  }
  
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Listener para mensagens do content script e popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateBadge") {
    // Verificar se a extensão está ativa antes de atualizar o badge
    chrome.storage.sync.get(['extensionEnabled'], function(result) {
      const isEnabled = result.extensionEnabled !== false;
      updateBadge(request.count, isEnabled);
    });
  }
  
  if (request.action === "updateExtensionState") {
    // Atualizar o badge baseado no novo estado da extensão
    chrome.storage.local.get(['hiddenVideos'], function(result) {
      const count = result.hiddenVideos ? result.hiddenVideos.length : 0;
      updateBadge(count, request.enabled);
    });
  }
});

// Inicializar badge ao carregar a extensão
chrome.storage.sync.get(['extensionEnabled'], function(result) {
  const isEnabled = result.extensionEnabled !== false;
  
  chrome.storage.local.get(['hiddenVideos'], function(result) {
    const count = result.hiddenVideos ? result.hiddenVideos.length : 0;
    updateBadge(count, isEnabled);
  });
});

// Inicializar configurações padrão ao instalar ou atualizar
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['videoAge', 'hideWatched', 'channelLimit', 'hidePlaylists', 'enableAltClick', 'extensionEnabled'], function(result) {
    const updates = {};
    if (typeof result.videoAge === 'undefined') updates.videoAge = '3';
    if (typeof result.hideWatched === 'undefined') updates.hideWatched = true;
    if (typeof result.channelLimit === 'undefined') updates.channelLimit = 2;
    if (typeof result.hidePlaylists === 'undefined') updates.hidePlaylists = true;
    if (typeof result.enableAltClick === 'undefined') updates.enableAltClick = true;
    if (typeof result.extensionEnabled === 'undefined') updates.extensionEnabled = true;
    
    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
}); 