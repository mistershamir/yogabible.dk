<script>
  (function(){
    var header = document.getElementById('yb-header');
    if(!header) return;

    var host = window.location.hostname.toLowerCase();
    var isEN = host.indexOf("en.") === 0;
    var lang = isEN ? "en" : "da";

    var path = window.location.pathname || "/";
    var qs = window.location.search || "";
    var hash = window.location.hash || "";
    var daURL = "https://www.yogabible.dk" + path + qs + hash;
    var enURL = "https://en.yogabible.dk" + path + qs + hash;

    var dict = {
      da: {
        "nav.education":"Uddannelser",
        "nav.courses":"Kurser",
        "nav.mentorship":"Mentorship & Privat Træning",
        "nav.more":"Mere",
        "nav.yogabible":"Yoga Bible",
        "nav.ourstory":"Vores Historie",
        "nav.schedule":"Ugentligt Klasseskema",
        "nav.careers":"Karriere",
        "nav.terms":"Handelsbetingelser",
        "nav.privacy":"Privatlivspolitik",
        "nav.conduct":"Code of Conduct",
        "nav.contact":"Kontakt",
        "nav.apply":"Ansøg",
        "edu.200.title":"200-timer Yogalæreuddannelse",
        "edu.200.18":"18 ugers fleksibel",
        "edu.200.4":"4 ugers intensiv",
        "edu.200.about":"Om 200-timers yogalæreruddannelser",
        "more.photo":"Yoga Fotografi",
        "more.music":"Yoga Musik",
        "more.glossary":"Yoga Ordbog",
        "courses.inversions":"Inversions",
        "courses.splits":"Splits",
        "courses.backbends":"Backbends",
        "courses.bundles":"Kursus Bundles",
        "mobile.menu":"Menu"
      },
      en: {
        "nav.education":"Educations",
        "nav.courses":"Courses",
        "nav.mentorship":"Mentorship & Private Training",
        "nav.more":"More",
        "nav.yogabible":"Yoga Bible",
        "nav.ourstory":"Our Story",
        "nav.schedule":"Weekly Class Schedule",
        "nav.careers":"Careers",
        "nav.terms":"Terms & Conditions",
        "nav.privacy":"Privacy Policy",
        "nav.conduct":"Code of Conduct",
        "nav.contact":"Contact",
        "nav.apply":"Apply",
        "edu.200.title":"200-hour Yoga Teacher Training",
        "edu.200.18":"18-week flexible",
        "edu.200.4":"4-week intensive",
        "edu.200.about":"About 200-hour yoga teacher trainings",
        "more.photo":"Yoga Photography",
        "more.music":"Yoga Music",
        "more.glossary":"Yoga Glossary",
        "courses.inversions":"Inversions",
        "courses.splits":"Splits",
        "courses.backbends":"Backbends",
        "courses.bundles":"Course Bundles",
        "mobile.menu":"Menu"
      }
    };

    // Apply translations
    header.querySelectorAll('[data-i18n]').forEach(function(el){
      var k = el.getAttribute('data-i18n');
      if(dict[lang] && dict[lang][k]) el.textContent = dict[lang][k];
    });

    // Set flag URLs and highlight active language
    function weglotSwitch(to){
      try{
        if(window.Weglot && typeof window.Weglot.switchTo === "function"){
          window.Weglot.switchTo(to);
          return true;
        }
      }catch(e){}
      return false;
    }

    header.querySelectorAll('[data-lang]').forEach(function(a){
      var v = a.getAttribute('data-lang');
      if(v === "da") a.href = daURL;
      if(v === "en") a.href = enURL;
      
      // Highlight active language
      if(v === lang){
        a.classList.add('is-active');
      }
      
      a.addEventListener('click', function(e){
        if(weglotSwitch(v)) e.preventDefault();
      });
    });

    // Desktop dropdowns
    var dds = header.querySelectorAll('[data-ybhd-dd]');
    var isDesktop = function(){ return window.matchMedia("(min-width:980px)").matches; };

    function openDD(dd){
      dd.classList.add('is-open');
      var btn = dd.querySelector('.ybhd-dd__trigger');
      if(btn) btn.setAttribute('aria-expanded','true');
    }
    function closeDD(dd){
      dd.classList.remove('is-open');
      var btn = dd.querySelector('.ybhd-dd__trigger');
      if(btn) btn.setAttribute('aria-expanded','false');
    }

    dds.forEach(function(dd){
      var btn = dd.querySelector('.ybhd-dd__trigger');
      var menu = dd.querySelector('.ybhd-dd__menu');
      if(!btn || !menu) return;

      var closeTimer = null;
      function cancelClose(){ if(closeTimer) clearTimeout(closeTimer); closeTimer = null; }
      function scheduleClose(){
        cancelClose();
        closeTimer = setTimeout(function(){ closeDD(dd); }, 140);
      }
      function onEnter(){
        if(!isDesktop()) return;
        cancelClose();
        openDD(dd);
      }
      function onLeave(){
        if(!isDesktop()) return;
        scheduleClose();
      }

      btn.addEventListener('pointerenter', onEnter);
      btn.addEventListener('pointerleave', onLeave);
      menu.addEventListener('pointerenter', onEnter);
      menu.addEventListener('pointerleave', onLeave);

      btn.addEventListener('click', function(e){
        if(!isDesktop()) return;
        e.preventDefault();
        var open = dd.classList.contains('is-open');
        dds.forEach(function(x){ if(x !== dd) closeDD(x); });
        open ? closeDD(dd) : openDD(dd);
      });
    });

    document.addEventListener('click', function(e){
      if(!header.contains(e.target)) dds.forEach(closeDD);
    });

    // Mobile drawer
    var burger = header.querySelector('.ybhd-burger');
    var drawer = document.getElementById('ybhdMobileNav');
    var closeEls = drawer ? drawer.querySelectorAll('[data-close]') : [];

    function openDrawer(){
      if(!drawer) return;
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden','false');
      burger && burger.setAttribute('aria-expanded','true');
      document.documentElement.style.overflow = 'hidden';
    }
    function closeDrawer(){
      if(!drawer) return;
      drawer.hidden = true;
      drawer.setAttribute('aria-hidden','true');
      burger && burger.setAttribute('aria-expanded','false');
      document.documentElement.style.overflow = '';
    }

    if(burger){
      burger.addEventListener('click', function(){
        var expanded = burger.getAttribute('aria-expanded') === 'true';
        expanded ? closeDrawer() : openDrawer();
      });
    }
    closeEls.forEach(function(el){ el.addEventListener('click', closeDrawer); });

    // Mobile accordions
    if(drawer){
      drawer.querySelectorAll('[data-mgroup]').forEach(function(btn){
        btn.addEventListener('click', function(){
          var next = btn.nextElementSibling;
          if(!next || !next.classList.contains('ybhd-mItems')) return;
          var open = next.style.display === 'flex';
          next.style.display = open ? 'none' : 'flex';
          btn.classList.toggle('is-open', !open);
          btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        });
      });
    }

    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){
        dds.forEach(closeDD);
        closeDrawer();
      }
    });
  })();
</script><script>Static.COOKIE_BANNER_CAPABLE = true;</script>
