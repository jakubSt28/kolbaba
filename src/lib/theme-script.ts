/**
 * Runs in <head> before the first paint, so a dark choice doesn't flash light: it reads the choice the
 * store keeps on this device and follows the system while it's "auto". Kept tiny and ES5.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t;["kolbaba-ui","kolbaba-prototype"].forEach(function(k){var v=!t&&localStorage.getItem(k);if(v)t=(JSON.parse(v).state||{}).theme});if(t)d.setAttribute("data-theme-setting",t);var m=matchMedia("(prefers-color-scheme: dark)");var a=function(){var s=d.getAttribute("data-theme-setting")||"auto";d.setAttribute("data-theme",s==="dark"||(s!=="light"&&m.matches)?"dark":"light")};a();m.addEventListener("change",a)}catch(e){}})()`;
