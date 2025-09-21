(function () {
  try {
    var stored = localStorage.getItem('theme'); // 'light' | 'dark' | null
    var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (systemDark ? 'dark' : 'light');

    var root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');

    // keep in sync with system if user never explicitly chose
    if (!stored && window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (localStorage.getItem('theme')) return; // user override exists
        if (mq.matches) root.classList.add('dark'); else root.classList.remove('dark');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else mq.addListener(onChange);
    }
  } catch (_) {}
})();
