document.addEventListener('DOMContentLoaded', function() {
  const keywordList = document.getElementById('keywordList');
  const saveButton = document.getElementById('saveButton');
  const totalHidden = document.getElementById('totalHidden');
  const hiddenVideosList = document.getElementById('hiddenVideosList');
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const videoAgeSelect = document.getElementById('videoAge');
  const hideWatchedCheckbox = document.getElementById('hideWatched');
  const enableAltClickCheckbox = document.getElementById('enableAltClick');
  const hideAdvancedDiscoveryCheckbox = document.getElementById('hideAdvancedDiscovery');
  const hideDuplicatesCheckbox = document.getElementById('hideDuplicates');
  const extensionToggle = document.getElementById('extensionToggle');
  const switchStatus = document.getElementById('switchStatus');

  // Função para atualizar o status do switch
  function updateSwitchStatus(isActive) {
    extensionToggle.checked = isActive;
    if (isActive) {
      switchStatus.textContent = 'Ativa';
      switchStatus.className = 'switch-status active';
    } else {
      switchStatus.textContent = 'Inativa';
      switchStatus.className = 'switch-status inactive';
    }
  }

  // Função para formatar a data
  function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Gerenciar abas
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      
      // Atualizar classes das abas
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Atualizar conteúdo das abas
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabName}-tab`) {
          content.classList.add('active');
        }
      });

      // Se for a aba de estatísticas, atualizar os dados
      if (tabName === 'stats') {
        updateStats();
      }
    });
  });

  // Carregar configurações salvas
  chrome.storage.sync.get(['keywords', 'videoAge', 'hideWatched', 'channelLimit', 'hidePlaylists', 'enableAltClick', 'extensionEnabled', 'hideAdvancedDiscovery', 'hideDuplicates'], function(result) {
    if (result.keywords) {
      keywordList.value = result.keywords.join('\n');
    }
    videoAgeSelect.value = typeof result.videoAge !== 'undefined' ? result.videoAge : '3';
    hideWatchedCheckbox.checked = typeof result.hideWatched !== 'undefined' ? result.hideWatched : true;
    document.getElementById('channelLimit').value = typeof result.channelLimit !== 'undefined' ? result.channelLimit : 2;
    document.getElementById('hidePlaylists').checked = typeof result.hidePlaylists !== 'undefined' ? result.hidePlaylists : true;
    enableAltClickCheckbox.checked = typeof result.enableAltClick !== 'undefined' ? result.enableAltClick : true;
    hideAdvancedDiscoveryCheckbox.checked = typeof result.hideAdvancedDiscovery !== 'undefined' ? result.hideAdvancedDiscovery : true;
    hideDuplicatesCheckbox.checked = typeof result.hideDuplicates !== 'undefined' ? result.hideDuplicates : true;
    // Carregar estado da extensão (padrão: ativa)
    const isEnabled = result.extensionEnabled !== false; // true por padrão
    updateSwitchStatus(isEnabled);
  });

  // Listener para o switch da extensão
  extensionToggle.addEventListener('change', function() {
    const isEnabled = this.checked;
    
    chrome.storage.sync.set({ extensionEnabled: isEnabled }, function() {
      updateSwitchStatus(isEnabled);
      
      // Notificar a página do YT sobre a mudança de estado
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "extensionStateChanged", 
            enabled: isEnabled
          });
        }
      });
      
      // Atualizar o badge no background
      chrome.runtime.sendMessage({
        action: "updateExtensionState", 
        enabled: isEnabled
      });
    });
  });

  // Salvar palavras-chave e idade
  saveButton.addEventListener('click', function() {
    const keywords = keywordList.value
      .split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0);
    
    const videoAge = videoAgeSelect.value;
    const hideWatched = hideWatchedCheckbox.checked;
    const channelLimit = parseInt(document.getElementById('channelLimit').value || '0');
    const hidePlaylists = document.getElementById('hidePlaylists').checked;
    const enableAltClick = enableAltClickCheckbox.checked;
    const hideAdvancedDiscovery = hideAdvancedDiscoveryCheckbox.checked;
    const hideDuplicates = hideDuplicatesCheckbox.checked;

    chrome.storage.sync.set({ 
      keywords: keywords,
      videoAge: videoAge,
      hideWatched: hideWatched,
      channelLimit: channelLimit,
      hidePlaylists: hidePlaylists,
      enableAltClick: enableAltClick,
      hideAdvancedDiscovery: hideAdvancedDiscovery,
      hideDuplicates: hideDuplicates
    }, function() {
      // Notificar a página do YT para atualizar
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {action: "updateKeywords"});
        }
      });
    });
  });

  // Função para atualizar estatísticas
  function updateStats() {
    chrome.storage.local.get(['hiddenVideos'], function(result) {
      const hiddenVideos = result.hiddenVideos || [];
      totalHidden.textContent = hiddenVideos.length;

      // Separar por motivo
      const byKeyword = hiddenVideos.filter(v => v.reason === 'keyword');
      const byDate = hiddenVideos.filter(v => v.reason === 'date');
      const byWatched = hiddenVideos.filter(v => v.reason === 'watched');
      const byChannelLimit = hiddenVideos.filter(v => v.reason === 'channelLimit');
      const byPlaylist = hiddenVideos.filter(v => v.reason === 'playlist');

      // Limpar listas
      document.getElementById('hiddenVideosList-keyword').innerHTML = '';
      document.getElementById('hiddenVideosList-date').innerHTML = '';
      document.getElementById('hiddenVideosList-watched').innerHTML = '';
      document.getElementById('hiddenVideosList-channelLimit').innerHTML = '';
      document.getElementById('hiddenVideosList-playlist').innerHTML = '';

      // Função para criar elemento de vídeo
      function createVideoElement(video) {
        const videoElement = document.createElement('div');
        videoElement.className = 'video-item';
        const thumbnail = document.createElement('img');
        thumbnail.className = 'video-thumbnail';
        thumbnail.src = video.thumbnail;
        thumbnail.alt = video.title;
        const infoContainer = document.createElement('div');
        infoContainer.className = 'video-info';
        const title = document.createElement('div');
        title.className = 'video-title';
        title.textContent = video.title;
        const date = document.createElement('div');
        date.className = 'video-date';
        date.textContent = `${formatDate(video.timestamp)} • ${video.age || 'Idade desconhecida'}`;
        infoContainer.appendChild(title);
        infoContainer.appendChild(date);
        videoElement.appendChild(thumbnail);
        videoElement.appendChild(infoContainer);
        videoElement.addEventListener('click', () => {
          chrome.tabs.create({ url: video.url });
        });
        return videoElement;
      }

      byKeyword.forEach(video => {
        document.getElementById('hiddenVideosList-keyword').appendChild(createVideoElement(video));
      });
      byDate.forEach(video => {
        document.getElementById('hiddenVideosList-date').appendChild(createVideoElement(video));
      });
      byWatched.forEach(video => {
        document.getElementById('hiddenVideosList-watched').appendChild(createVideoElement(video));
      });
      byChannelLimit.forEach(video => {
        document.getElementById('hiddenVideosList-channelLimit').appendChild(createVideoElement(video));
      });
      byPlaylist.forEach(video => {
        document.getElementById('hiddenVideosList-playlist').appendChild(createVideoElement(video));
      });
    });
  }

  // Tabs de estatísticas
  document.querySelectorAll('.stats-tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.stats-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.stats-tab-content').forEach(tab => tab.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('hiddenVideosList-' + btn.getAttribute('data-stats-tab')).classList.add('active');
    });
  });
}); 