/* Fills .meter[data-lv="0-20"][data-n="20"] with segments (green→amber→red). Optional: vertical via .meter.v */
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.meter[data-lv]').forEach(function(m){
    var n=+(m.dataset.n||20), lv=+m.dataset.lv, h='';
    for(var k=0;k<n;k++){var c=k<lv?(k>n*0.85?'r':k>n*0.65?'y':'g'):'';h+='<i class="'+c+'"></i>';}
    m.innerHTML=h;
  });
});
