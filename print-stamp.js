/* The print date and time at the foot of every printed page.

   Loaded on every portal page, so anything printed from the portal --
   an employee record, the employee list, the company policy -- carries
   the moment it was printed, the same line the HR documents draw into
   their PDFs. It is written into a page margin box (@page @bottom-right)
   just before printing, so it sits in the margin on each sheet and
   never covers the page's own content. Browsers that do not draw margin
   boxes print the page as before, without it.
*/
(function () {
  'use strict';

  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  var RLM = '‏';
  function ar(s) { return String(s).replace(/[0-9]/g, function (d) { return AR_DIGITS[d]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* "تاريخ ووقت الطباعة: ١٨/١١/٢٠٢٦ - ٢:٤٠ ص", in the computer's own
     time; the date reads from the right, day first, as in the documents. */
  function stamp(now) {
    var date = [pad(now.getDate()), pad(now.getMonth() + 1), now.getFullYear()]
      .map(ar).join(RLM + '/' + RLM);
    var h = now.getHours();
    var time = ar((h % 12 || 12) + ':' + pad(now.getMinutes()));
    return 'تاريخ ووقت الطباعة: ' + date + ' - ' + time + ' ' + (h < 12 ? 'ص' : 'م');
  }

  function cssString(s) { return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

  function set() {
    var style = document.getElementById('printStampStyle');
    if (!style) {
      style = document.createElement('style');
      style.id = 'printStampStyle';
      document.head.appendChild(style);
    }
    style.textContent = '@page { @bottom-right { content: ' + cssString(stamp(new Date())) +
      '; font: 9px "Times New Roman", Times, serif; color: #000; direction: rtl; vertical-align: middle; } }';
  }

  window.IEnergyPrintStamp = { text: stamp };
  window.addEventListener('beforeprint', set);
})();
