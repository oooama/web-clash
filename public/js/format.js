// Byte / duration formatters used by the dashboard and profile cards.
export function fmtB(b){if(!b)return'0 B';const k=1024,s=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(k));return(b/Math.pow(k,i)).toFixed(1)+' '+s[i];}

export function fmtDur(s){if(!s)return'0s';const h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return h?h+'h '+m+'m':m?m+'m '+ss+'s':ss+'s';}

export function fmtSz(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(0)+' KB';if(b<1073741824)return(b/1048576).toFixed(1)+' MB';return(b/1073741824).toFixed(2)+' GB';}
