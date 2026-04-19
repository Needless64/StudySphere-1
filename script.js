/* ============================================
   StudySphere — Global Script
   script.js
   ============================================ */

/* ── Default cursor, hide custom ring/dot ── */
document.body.style.cursor = 'default';
const _ring = document.getElementById('cursor-ring');
const _dot  = document.getElementById('cursor-dot');
if (_ring) _ring.style.display = 'none';
if (_dot)  _dot.style.display  = 'none';

/* ── Splash canvas setup ── */
const cv = document.getElementById('splash');
if (cv) {
  cv.style.position      = 'fixed';
  cv.style.top           = '0';
  cv.style.left          = '0';
  cv.style.width         = '100vw';
  cv.style.height        = '100vh';
  cv.style.pointerEvents = 'none';
  cv.style.zIndex        = '0';
}

/* ═══════════════════════════════════════════════
   WEBGL FLUID — purple/violet ribbon trails
═══════════════════════════════════════════════ */
if (cv) {
  const config = {
    SIM_RESOLUTION:       128,
    DYE_RESOLUTION:       1440,
    DENSITY_DISSIPATION:  5.0,
    VELOCITY_DISSIPATION: 2.5,
    PRESSURE:             0.1,
    PRESSURE_ITERATIONS:  15,
    CURL:                 12,
    SPLAT_RADIUS:         0.09,
    SPLAT_FORCE:          6000,
  };

  function pointerProto() {
    this.texcoordX = 0; this.texcoordY = 0;
    this.prevTexcoordX = 0; this.prevTexcoordY = 0;
    this.deltaX = 0; this.deltaY = 0;
    this.down = false; this.moved = false;
    this.color = { r:0, g:0, b:0 };
  }
  const pointer = new pointerProto();

  function initGL(canvas) {
    const p = { alpha:true, depth:false, stencil:false, antialias:false, preserveDrawingBuffer:false };
    let gl = canvas.getContext('webgl2', p);
    const isGL2 = !!gl;
    if (!isGL2) gl = canvas.getContext('webgl', p);
    if (!gl) return null;
    let halfFloat, linearFilter;
    if (isGL2) {
      gl.getExtension('EXT_color_buffer_float');
      linearFilter = gl.getExtension('OES_texture_float_linear');
    } else {
      halfFloat    = gl.getExtension('OES_texture_half_float');
      linearFilter = gl.getExtension('OES_texture_half_float_linear');
    }
    gl.clearColor(0,0,0,1);
    const hfType = isGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
    function supportsFormat(iF,f,t) {
      const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,iF,4,4,0,f,t,null);
      const fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
    }
    function bestFormat(iF,f,t) {
      if(supportsFormat(iF,f,t)) return {internalFormat:iF,format:f};
      if(iF===gl.R16F)  return bestFormat(gl.RG16F,  gl.RG,  t);
      if(iF===gl.RG16F) return bestFormat(gl.RGBA16F,gl.RGBA,t);
      return null;
    }
    let fRGBA,fRG,fR;
    if(isGL2){fRGBA=bestFormat(gl.RGBA16F,gl.RGBA,hfType);fRG=bestFormat(gl.RG16F,gl.RG,hfType);fR=bestFormat(gl.R16F,gl.RED,hfType);}
    else{fRGBA=bestFormat(gl.RGBA,gl.RGBA,hfType);fRG=bestFormat(gl.RGBA,gl.RGBA,hfType);fR=bestFormat(gl.RGBA,gl.RGBA,hfType);}
    return {gl,hfType,fRGBA,fRG,fR,linearFilter};
  }

  const glR = initGL(cv);
  if (glR) {
    const {gl,hfType,fRGBA,fRG,fR,linearFilter} = glR;
    if(!linearFilter) config.DYE_RESOLUTION=256;

    function sh(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s;}
    function prog(vs,fs){
      const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
      const u={};const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);
      for(let i=0;i<n;i++){const name=gl.getActiveUniform(p,i).name;u[name]=gl.getUniformLocation(p,name);}
      return{program:p,u,bind(){gl.useProgram(this.program);}};
    }
    const VS=sh(gl.VERTEX_SHADER,`precision highp float;attribute vec2 aPosition;varying vec2 vUv,vL,vR,vT,vB;uniform vec2 texelSize;void main(){vUv=aPosition*.5+.5;vL=vUv-vec2(texelSize.x,0.);vR=vUv+vec2(texelSize.x,0.);vT=vUv+vec2(0.,texelSize.y);vB=vUv-vec2(0.,texelSize.y);gl_Position=vec4(aPosition,0.,1.);}`);
    const copyP  =prog(VS,sh(gl.FRAGMENT_SHADER,`precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;uniform sampler2D uTexture;void main(){gl_FragColor=texture2D(uTexture,vUv);}`));
    const clearP =prog(VS,sh(gl.FRAGMENT_SHADER,`precision mediump float;precision mediump sampler2D;varying highp vec2 vUv;uniform sampler2D uTexture;uniform float value;void main(){gl_FragColor=value*texture2D(uTexture,vUv);}`));
    const splatP =prog(VS,sh(gl.FRAGMENT_SHADER,`precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uTarget;uniform float aspectRatio;uniform vec3 color;uniform vec2 point;uniform float radius;uniform vec2 dir;void main(){vec2 p=vUv-point;p.x*=aspectRatio;float len=length(dir)+0.0001;vec2 along=dir/len;vec2 perp=vec2(-along.y,along.x);float a=dot(p,along);float b=dot(p,perp);float r2=radius;float r1=r2*5.5;vec3 splat=exp(-(a*a/r1+b*b/r2))*color;gl_FragColor=vec4(texture2D(uTarget,vUv).xyz+splat,1.);}`));
    const advP   =prog(VS,sh(gl.FRAGMENT_SHADER,`precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uVelocity,uSource;uniform vec2 texelSize;uniform float dt,dissipation;void main(){vec2 coord=vUv-dt*texture2D(uVelocity,vUv).xy*texelSize;gl_FragColor=texture2D(uSource,coord)/(1.+dissipation*dt);}`));
    const divP   =prog(VS,sh(gl.FRAGMENT_SHADER,`precision mediump float;precision mediump sampler2D;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).x,R=texture2D(uVelocity,vR).x,T=texture2D(uVelocity,vT).y,B=texture2D(uVelocity,vB).y;vec2 C=texture2D(uVelocity,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;gl_FragColor=vec4(.5*(R-L+T-B),0.,0.,1.);}`));
    const curlP  =prog(VS,sh(gl.FRAGMENT_SHADER,`precision mediump float;precision mediump sampler2D;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity;void main(){gl_FragColor=vec4(.5*(texture2D(uVelocity,vR).y-texture2D(uVelocity,vL).y-texture2D(uVelocity,vT).x+texture2D(uVelocity,vB).x),0.,0.,1.);}`));
    const vortP  =prog(VS,sh(gl.FRAGMENT_SHADER,`precision highp float;precision highp sampler2D;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity,uCurl;uniform float curl,dt;void main(){float L=texture2D(uCurl,vL).x,R=texture2D(uCurl,vR).x,T=texture2D(uCurl,vT).x,B=texture2D(uCurl,vB).x,C=texture2D(uCurl,vUv).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f=f/(length(f)+.0001)*curl*C;f.y*=-1.;vec2 v=texture2D(uVelocity,vUv).xy+f*dt;gl_FragColor=vec4(clamp(v,-1000.,1000.),0.,1.);}`));
    const presP  =prog(VS,sh(gl.FRAGMENT_SHADER,`precision mediump float;precision mediump sampler2D;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uPressure,uDivergence;void main(){gl_FragColor=vec4((.25*(texture2D(uPressure,vL).x+texture2D(uPressure,vR).x+texture2D(uPressure,vT).x+texture2D(uPressure,vB).x-texture2D(uDivergence,vUv).x)),0.,0.,1.);}`));
    const gradP  =prog(VS,sh(gl.FRAGMENT_SHADER,`precision mediump float;precision mediump sampler2D;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uPressure,uVelocity;void main(){vec2 v=texture2D(uVelocity,vUv).xy-vec2(texture2D(uPressure,vR).x-texture2D(uPressure,vL).x,texture2D(uPressure,vT).x-texture2D(uPressure,vB).x);gl_FragColor=vec4(v,0.,1.);}`));
    const displayP=prog(VS,sh(gl.FRAGMENT_SHADER,`precision highp float;precision highp sampler2D;varying vec2 vUv;uniform sampler2D uTexture;void main(){vec3 c=texture2D(uTexture,vUv).rgb;float a=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c,a*0.9);}`));

    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,-1,1,1,1,1,-1]),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),gl.STATIC_DRAW);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.enableVertexAttribArray(0);

    function blit(target,clear=false){
      if(!target){gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
      else{gl.viewport(0,0,target.width,target.height);gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);}
      if(clear){gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);}
      gl.drawElements(gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0);
    }
    function makeFBO(w,h,iF,f,t,filter){
      gl.activeTexture(gl.TEXTURE0);const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,iF,w,h,0,f,t,null);
      const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT);
      return{tex,fbo,width:w,height:h,tx:1/w,ty:1/h,attach(id){gl.activeTexture(gl.TEXTURE0+id);gl.bindTexture(gl.TEXTURE_2D,tex);return id;}};
    }
    function makeDoubleFBO(w,h,iF,f,t,filter){
      let a=makeFBO(w,h,iF,f,t,filter),b=makeFBO(w,h,iF,f,t,filter);
      return{width:w,height:h,tx:a.tx,ty:a.ty,get read(){return a;},get write(){return b;},swap(){let tmp=a;a=b;b=tmp;}};
    }
    function getRes(r){let ar=gl.drawingBufferWidth/gl.drawingBufferHeight;if(ar<1)ar=1/ar;const mn=Math.round(r),mx=Math.round(r*ar);return gl.drawingBufferWidth>gl.drawingBufferHeight?{width:mx,height:mn}:{width:mn,height:mx};}

    let dye,vel,div,curl,pres;
    function initFBOs(){
      const S=getRes(config.SIM_RESOLUTION),D=getRes(config.DYE_RESOLUTION);
      const filter=linearFilter?gl.LINEAR:gl.NEAREST;gl.disable(gl.BLEND);
      dye=makeDoubleFBO(D.width,D.height,fRGBA.internalFormat,fRGBA.format,hfType,filter);
      vel=makeDoubleFBO(S.width,S.height,fRG.internalFormat,fRG.format,hfType,filter);
      div=makeFBO(S.width,S.height,fR.internalFormat,fR.format,hfType,gl.NEAREST);
      curl=makeFBO(S.width,S.height,fR.internalFormat,fR.format,hfType,gl.NEAREST);
      pres=makeDoubleFBO(S.width,S.height,fR.internalFormat,fR.format,hfType,gl.NEAREST);
    }
    function resizeCanvas(){const w=Math.floor(cv.clientWidth*(window.devicePixelRatio||1)),h=Math.floor(cv.clientHeight*(window.devicePixelRatio||1));if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;return true;}return false;}

    function purpleColor(){
      const hue=260+Math.random()*60,s=0.85,v=0.9;
      const i=Math.floor(hue/60)%6,f=(hue/60)-Math.floor(hue/60);
      const p=v*(1-s),q=v*(1-f*s),t2=v*(1-(1-f)*s);
      let r,g,b;
      if(i===0){r=v;g=t2;b=p;}else if(i===1){r=q;g=v;b=p;}else if(i===2){r=p;g=v;b=t2;}else if(i===3){r=p;g=q;b=v;}else if(i===4){r=t2;g=p;b=v;}else{r=v;g=p;b=q;}
      return{r:r*0.08,g:g*0.08,b:b*0.08};
    }
    function correctRadius(r){const ar=cv.width/cv.height;return ar>1?r*ar:r;}
    function correctDX(d){const ar=cv.width/cv.height;return ar<1?d*ar:d;}
    function correctDY(d){const ar=cv.width/cv.height;return ar>1?d/ar:d;}

    function splat(x,y,dx,dy,color){
      splatP.bind();const len=Math.sqrt(dx*dx+dy*dy)+0.0001;
      gl.uniform1i(splatP.u.uTarget,vel.read.attach(0));gl.uniform1f(splatP.u.aspectRatio,cv.width/cv.height);
      gl.uniform2f(splatP.u.point,x,y);gl.uniform2f(splatP.u.dir,dx/len,dy/len);
      gl.uniform3f(splatP.u.color,dx,dy,0);gl.uniform1f(splatP.u.radius,correctRadius(config.SPLAT_RADIUS/100));
      blit(vel.write);vel.swap();
      gl.uniform1i(splatP.u.uTarget,dye.read.attach(0));gl.uniform2f(splatP.u.dir,dx/len,dy/len);
      gl.uniform3f(splatP.u.color,color.r,color.g,color.b);blit(dye.write);dye.swap();
    }

    function step(dt){
      gl.disable(gl.BLEND);
      curlP.bind();gl.uniform2f(curlP.u.texelSize,vel.tx,vel.ty);gl.uniform1i(curlP.u.uVelocity,vel.read.attach(0));blit(curl);
      vortP.bind();gl.uniform2f(vortP.u.texelSize,vel.tx,vel.ty);gl.uniform1i(vortP.u.uVelocity,vel.read.attach(0));gl.uniform1i(vortP.u.uCurl,curl.attach(1));gl.uniform1f(vortP.u.curl,config.CURL);gl.uniform1f(vortP.u.dt,dt);blit(vel.write);vel.swap();
      divP.bind();gl.uniform2f(divP.u.texelSize,vel.tx,vel.ty);gl.uniform1i(divP.u.uVelocity,vel.read.attach(0));blit(div);
      clearP.bind();gl.uniform1i(clearP.u.uTexture,pres.read.attach(0));gl.uniform1f(clearP.u.value,config.PRESSURE);blit(pres.write);pres.swap();
      presP.bind();gl.uniform2f(presP.u.texelSize,vel.tx,vel.ty);gl.uniform1i(presP.u.uDivergence,div.attach(0));
      for(let i=0;i<config.PRESSURE_ITERATIONS;i++){gl.uniform1i(presP.u.uPressure,pres.read.attach(1));blit(pres.write);pres.swap();}
      gradP.bind();gl.uniform2f(gradP.u.texelSize,vel.tx,vel.ty);gl.uniform1i(gradP.u.uPressure,pres.read.attach(0));gl.uniform1i(gradP.u.uVelocity,vel.read.attach(1));blit(vel.write);vel.swap();
      advP.bind();gl.uniform2f(advP.u.texelSize,vel.tx,vel.ty);const vid=vel.read.attach(0);gl.uniform1i(advP.u.uVelocity,vid);gl.uniform1i(advP.u.uSource,vid);gl.uniform1f(advP.u.dt,dt);gl.uniform1f(advP.u.dissipation,config.VELOCITY_DISSIPATION);blit(vel.write);vel.swap();
      gl.uniform1i(advP.u.uVelocity,vel.read.attach(0));gl.uniform1i(advP.u.uSource,dye.read.attach(1));gl.uniform1f(advP.u.dissipation,config.DENSITY_DISSIPATION);blit(dye.write);dye.swap();
    }

    function scaleByDPR(v){return Math.floor(v*(window.devicePixelRatio||1));}
    let firstMove=false;
    window.addEventListener('mousemove',e=>{
      const x=scaleByDPR(e.clientX),y=scaleByDPR(e.clientY);
      if(!firstMove){pointer.texcoordX=x/cv.width;pointer.texcoordY=1-y/cv.height;pointer.prevTexcoordX=pointer.texcoordX;pointer.prevTexcoordY=pointer.texcoordY;pointer.color=purpleColor();firstMove=true;}
      pointer.prevTexcoordX=pointer.texcoordX;pointer.prevTexcoordY=pointer.texcoordY;
      pointer.texcoordX=x/cv.width;pointer.texcoordY=1-y/cv.height;
      pointer.deltaX=correctDX(pointer.texcoordX-pointer.prevTexcoordX);pointer.deltaY=correctDY(pointer.texcoordY-pointer.prevTexcoordY);
      pointer.moved=Math.abs(pointer.deltaX)>0||Math.abs(pointer.deltaY)>0;
    });
    window.addEventListener('mousedown',e=>{
      const x=scaleByDPR(e.clientX),y=scaleByDPR(e.clientY);
      pointer.texcoordX=x/cv.width;pointer.texcoordY=1-y/cv.height;
      const c=purpleColor();c.r*=6;c.g*=6;c.b*=6;
      splat(pointer.texcoordX,pointer.texcoordY,(Math.random()-.5)*8,(Math.random()-.5)*8,c);
    });
    window.addEventListener('touchmove',e=>{
      const t=e.targetTouches[0];const x=scaleByDPR(t.clientX),y=scaleByDPR(t.clientY);
      pointer.prevTexcoordX=pointer.texcoordX;pointer.prevTexcoordY=pointer.texcoordY;
      pointer.texcoordX=x/cv.width;pointer.texcoordY=1-y/cv.height;
      pointer.deltaX=correctDX(pointer.texcoordX-pointer.prevTexcoordX);pointer.deltaY=correctDY(pointer.texcoordY-pointer.prevTexcoordY);
      pointer.moved=true;
    },false);

    initFBOs();
    let lastTime=Date.now(),colorTimer=0;
    (function loop(){
      const now=Date.now(),dt=Math.min((now-lastTime)/1000,0.016666);lastTime=now;
      if(resizeCanvas())initFBOs();
      colorTimer+=dt*config.SPLAT_FORCE*0.0001;if(colorTimer>=1){colorTimer=0;pointer.color=purpleColor();}
      if(pointer.moved){pointer.moved=false;splat(pointer.texcoordX,pointer.texcoordY,pointer.deltaX*config.SPLAT_FORCE,pointer.deltaY*config.SPLAT_FORCE,pointer.color);}
      step(dt);
      gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.enable(gl.BLEND);
      displayP.bind();gl.uniform1i(displayP.u.uTexture,dye.read.attach(0));blit(null);
      requestAnimationFrame(loop);
    })();
  }
}

/* ── Auth stubs removed — real implementations below ── */

/* ════════════════════════════════════════════
   UPGRADES
════════════════════════════════════════════ */

/* Page transition */
(function(){
  const overlay=document.createElement('div');overlay.id='page-transition';document.body.appendChild(overlay);
  window.addEventListener('load',()=>overlay.classList.remove('active'));
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[href]');if(!a)return;
    const href=a.getAttribute('href');if(!href||href.startsWith('#')||href.startsWith('http'))return;
    e.preventDefault();overlay.classList.add('active');setTimeout(()=>{window.location.href=href;},280);
  });
})();

/* Spotlight */
function initSpotlight(){
  document.querySelectorAll('.spotlight').forEach(el=>{
    el.addEventListener('mousemove',e=>{
      const rect=el.getBoundingClientRect();
      el.style.setProperty('--mx',`${e.clientX-rect.left}px`);
      el.style.setProperty('--my',`${e.clientY-rect.top}px`);
    });
  });
}

/* Count-up */
function countUp(el,target,duration=1200){
  const isTime=String(target).includes('h'),isRank=String(target)==='—';
  if(isRank){el.textContent='—';el.classList.add('counted');return;}
  const num=parseFloat(target),suffix=isTime?'h':'',start=performance.now();
  function step(now){
    const p=Math.min((now-start)/duration,1),ease=1-Math.pow(1-p,3);
    el.textContent=Math.floor(num*ease)+suffix;
    if(p<1)requestAnimationFrame(step);else{el.textContent=target;el.classList.add('counted');}
  }
  requestAnimationFrame(step);
}
function initCountUp(){
  document.querySelectorAll('.stat-val').forEach(el=>{
    const target=el.textContent.trim();
    el.textContent=target.includes('h')?'0h':target==='—'?'—':'0';
    setTimeout(()=>countUp(el,target),400);
  });
}

/* Fade-up */
function initFadeUp(){
  const els=document.querySelectorAll('.fade-up');if(!els.length)return;
  const obs=new IntersectionObserver(entries=>{
    entries.forEach((entry,i)=>{
      if(entry.isIntersecting){setTimeout(()=>entry.target.classList.add('visible'),i*80);obs.unobserve(entry.target);}
    });
  },{threshold:0.1});
  els.forEach(el=>obs.observe(el));
}

/* Toast */
function showToast(icon,msg,duration=3500){
  let container=document.getElementById('toast-container');
  if(!container){container=document.createElement('div');container.id='toast-container';document.body.appendChild(container);}
  const toast=document.createElement('div');toast.className='toast';
  const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  toast.innerHTML=`<span class="toast-icon">${icon}</span><span class="toast-msg">${msg}</span><span class="toast-time">${time}</span>`;
  container.appendChild(toast);
  setTimeout(()=>{toast.classList.add('out');setTimeout(()=>toast.remove(),300);},duration);
}

/* Glass + spotlight */
function applyGlassSpotlight(){
  document.querySelectorAll('.panel,.card,.stat-card,.welcome-banner').forEach(el=>{
    el.classList.add('glass','spotlight');
  });
}

/* Mesh bg */
function addMeshBg(){
  if(!document.querySelector('.mesh-bg')){
    const mesh=document.createElement('div');mesh.className='mesh-bg';
    document.body.insertBefore(mesh,document.body.firstChild);
  }
}

/* ═══════════════════════════════════════════════
   API — Auth, Rooms, Stats
═══════════════════════════════════════════════ */

/* Auth guard — call on protected pages */
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) throw new Error('not authenticated');
    const { user } = await res.json();
    // Refresh localStorage with server-verified user
    localStorage.setItem('ss_user', JSON.stringify(user));
    localStorage.setItem('ss_user_name', user.first_name);
    return user;
  } catch {
    localStorage.removeItem('ss_user');
    localStorage.removeItem('ss_user_name');
    window.location.replace('login.html');
    return null;
  }
}

async function handleLogin() {
  const btn = document.querySelector('button[onclick*="handleLogin"]');
  const originalText = btn?.innerHTML;
  const email    = (document.getElementById('login-email')    || document.querySelector('input[type="email"]'))?.value?.trim();
  const password = (document.getElementById('login-password') || document.querySelector('input[type="password"]'))?.value;
  if (!email || !password) { showToast('⚠️', 'Please fill in email and password'); return; }
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-shine"></span>Signing in…'; }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌', data.error || 'Login failed'); return; }
    localStorage.setItem('ss_user', JSON.stringify(data.user));
    localStorage.setItem('ss_user_name', data.user.first_name);
    showToast('✅', 'Welcome back, ' + data.user.first_name + '!');
    setTimeout(() => window.location.href = 'dashboard.html', 500);
  } catch { showToast('❌', 'Network error — is the server running?'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = originalText; } }
}

async function handleRegister() {
  const btn = document.querySelector('button[onclick*="handleRegister"]');
  const originalText = btn?.innerHTML;
  const fname    = document.getElementById('fname')?.value?.trim();
  const lname    = document.getElementById('lname')?.value?.trim();
  const email    = document.getElementById('reg-email')?.value?.trim();
  const password = document.getElementById('reg-password')?.value;
  const confirm  = document.getElementById('confirm-password')?.value;
  if (!fname || !lname || !email || !password) { showToast('⚠️', 'All fields are required'); return; }
  if (password.length < 8) { showToast('⚠️', 'Password must be at least 8 characters'); return; }
  if (confirm !== undefined && confirm !== '' && password !== confirm) {
    showToast('⚠️', 'Passwords do not match'); return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-shine"></span>Creating account…'; }
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: fname, last_name: lname, email, password })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌', data.error || 'Registration failed'); return; }
    localStorage.setItem('ss_user', JSON.stringify(data.user));
    localStorage.setItem('ss_user_name', data.user.first_name);
    localStorage.setItem('ss_is_new_user', '1');
    showToast('✅', 'Account created! Welcome, ' + data.user.first_name + '!');
    setTimeout(() => window.location.href = 'dashboard.html', 500);
  } catch { showToast('❌', 'Network error — is the server running?'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = originalText; } }
}

async function loadDashboard() {
  try {
    const [roomsRes, statsRes, myRoomsRes] = await Promise.all([
      fetch('/api/rooms', { credentials: 'include' }),
      fetch('/api/stats', { credentials: 'include' }),
      fetch('/api/rooms/my', { credentials: 'include' })
    ]);
    const { rooms }   = await roomsRes.json();
    const stats       = await statsRes.json();
    const myRoomsData = await myRoomsRes.json();
    const myRooms     = myRoomsData.rooms || [];

    // Stats cards — update and re-run countup on real values
    const statEls = document.querySelectorAll('.stat-val');
    const vals = [
      stats.day_streak    ?? '0',
      stats.study_time    ?? '0m',
      stats.resources_shared ?? '0',
      stats.leaderboard_rank ?? '—'
    ];
    statEls.forEach((el, i) => {
      el.classList.remove('counted');
      el.textContent = vals[i];
      countUp(el, vals[i]);
    });

    // Welcome name
    const user = JSON.parse(localStorage.getItem('ss_user') || '{}');
    const nameEl = document.querySelector('.welcome-name');
    if (nameEl && user.first_name) nameEl.textContent = user.first_name;
    const bannerEl = document.getElementById('bannerName');
    if (bannerEl && user.first_name) bannerEl.textContent = user.first_name + ', welcome back!';
    const avatarEl = document.getElementById('userAvatar');
    if (avatarEl && user.first_name) avatarEl.textContent = user.first_name.charAt(0).toUpperCase();

    // My Rooms panel
    renderMyRoomsFromBackend(myRooms);

    // Discover Rooms grid — replace with live backend data
    const grid = document.getElementById('rooms-grid');
    if (grid) {
      const liveRooms = (rooms||[]).filter(r => r.is_live);
      if (!liveRooms.length) {
        grid.innerHTML = '<div class="disc-empty">No active rooms right now. <button class="disc-create-link" onclick="openCreateRoom()">Create the first one →</button></div>';
      } else {
        grid.innerHTML = liveRooms.map(r => `
          <div class="disc-room spotlight" onclick="joinRoom(${r.id})">
            <div class="disc-dot dot-live"></div>
            <div style="flex:1;min-width:0">
              <div class="disc-name">${r.name.replace(/</g,'&lt;')}</div>
              <div class="disc-meta">${r.member_count} member${r.member_count!==1?'s':''} · ${r.subject}</div>
            </div>
            <button class="join-btn" onclick="event.stopPropagation();joinRoom(${r.id})">Join</button>
          </div>`).join('');
        initSpotlight();
      }
    }
  } catch(e) { console.error('Dashboard load error', e); }
}

function renderMyRoomsFromBackend(rooms) {
  const container = document.getElementById('myRoomsContent');
  const badge     = document.getElementById('myRoomsBadge');
  if (!container) return;
  if (badge) badge.textContent = rooms.length + (rooms.length === 1 ? ' room' : ' rooms');
  if (!rooms.length) {
    container.innerHTML = `
      <div class="my-rooms-empty">
        <div class="my-rooms-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5a4080" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
        </div>
        <h3>No rooms yet</h3>
        <p>Create your first study room or join a public one to get started.</p>
        <div class="my-rooms-empty-actions">
          <button class="empty-btn-primary" onclick="openCreateRoom()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create a Room
          </button>
          <button class="empty-btn-ghost" onclick="document.querySelector('.disc-rooms')?.scrollIntoView({behavior:'smooth'})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Explore Public Rooms
          </button>
        </div>
      </div>`;
    return;
  }
  const gradients = [
    'linear-gradient(135deg,#7c3aed,#ec4899)',
    'linear-gradient(135deg,#06b6d4,#3b82f6)',
    'linear-gradient(135deg,#f97316,#eab308)',
    'linear-gradient(135deg,#22c55e,#06b6d4)',
    'linear-gradient(135deg,#a855f7,#ec4899)',
  ];
  container.innerHTML = '<div class="room-cards">' + rooms.map((r, i) => `
    <div class="room-card spotlight" onclick="window.location.href='room.html?id=${r.id}'">
      <div class="room-card-icon" style="background:${gradients[i % gradients.length]}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      </div>
      <div class="room-card-info">
        <div class="room-card-name">${r.name.replace(/</g,'&lt;')}</div>
        <div class="room-card-meta">${r.subject} · ${r.member_count} member${r.member_count!==1?'s':''}</div>
      </div>
      <button class="room-card-enter" onclick="event.stopPropagation();window.location.href='room.html?id=${r.id}'">Enter →</button>
    </div>`).join('') + '</div>';
  initSpotlight();
}

async function joinRoom(id) {
  await fetch(`/api/rooms/${id}/join`, { method: 'POST', credentials: 'include' });
  window.location.href = `room.html?id=${id}`;
}

async function createRoom() {
  const name    = document.getElementById('room-name')?.value?.trim();
  const subject = document.getElementById('room-subject')?.value?.trim() || 'General';
  const desc    = document.getElementById('room-desc')?.value?.trim();
  if (!name) { showToast('⚠️','Room name required'); return; }
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subject, description: desc })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌', data.error || 'Failed to create room'); return; }
    showToast('✅', 'Room created!');
    window.location.href = `room.html?id=${data.room.id}`;
  } catch(e) { showToast('❌','Network error'); }
}

async function loadRoom() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('id');
  if (!roomId) return;

  try {
    // Auto-join on any entry (direct link or button — ON CONFLICT DO NOTHING on server)
    await fetch(`/api/rooms/${roomId}/join`, { method: 'POST', credentials: 'include' }).catch(() => {});

    const [roomRes, msgsRes, resRes] = await Promise.all([
      fetch(`/api/rooms/${roomId}`, { credentials: 'include' }),
      fetch(`/api/rooms/${roomId}/messages`, { credentials: 'include' }),
      fetch(`/api/rooms/${roomId}/resources`, { credentials: 'include' })
    ]);
    const { room }        = await roomRes.json();
    const { messages }    = await msgsRes.json();
    const { resources }   = await resRes.json();

    if (room) {
      window._roomHostId = room.host_id;
      if (typeof applyTimerOwnership === 'function') applyTimerOwnership();
      if (room.timer_state && typeof applyTimerSync === 'function') applyTimerSync(room.timer_state);
      const nameEl    = document.getElementById('roomTitle');
      const subjectEl = document.getElementById('roomSubject');
      if (nameEl)    nameEl.textContent    = room.name;
      if (subjectEl) subjectEl.textContent = room.subject || '';
      document.title = 'StudySphere – ' + room.name;
    }

    renderMessages(messages || []);
    renderResources(resources || []);

    // Load members
    const membersRes = await fetch(`/api/rooms/${roomId}/members`, { credentials: 'include' });
    if (membersRes.ok) {
      const { members } = await membersRes.json();
      renderMembers(members || []);
    }

    // Real-time via Pusher
    initPusher(roomId);
  } catch(e) { console.error('Room load error', e); }
}

let _typingTimer;

function initPusher(roomId) {
  const key = window.PUSHER_KEY;
  const cluster = window.PUSHER_CLUSTER;
  if (!key || typeof Pusher === 'undefined') return;

  const pusher  = new Pusher(key, { cluster, forceTLS: true });
  const channel = pusher.subscribe('room-' + roomId);

  // New chat message
  channel.bind('new-message', (msg) => {
    const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
    if (Number(msg.user_id) === Number(me.id)) return; // already rendered locally
    appendMessage(msg);
  });

  // Notes updated by someone else
  channel.bind('notes-update', (data) => {
    const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
    if (data.updated_by === me.id) return;
    const notesEl = document.getElementById('notesArea');
    if (notesEl && document.activeElement !== notesEl) {
      notesEl.value = data.notes;
    }
    showTypingBadge(data.updated_by_name + ' is editing notes…', 3000);
  });

  // Typing indicator
  channel.bind('typing', (data) => {
    const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
    if (data.user_id === me.id) return;
    showTypingBadge(data.name + ' is typing…', 2500);
  });

  // Member joined — refresh member list
  channel.bind('member-joined', () => {
    fetch(`/api/rooms/${roomId}/members`, { credentials: 'include' })
      .then(r => r.json())
      .then(({ members }) => renderMembers(members || []));
  });

  channel.bind('presence-update', ({ user_id, status }) => {
    const dot = document.querySelector(`[data-member-id="${user_id}"] .room-presence-dot`);
    if (dot) dot.className = `room-presence-dot ${status}`;
  });

  // New resource shared
  channel.bind('new-resource', (resource) => {
    const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
    if (Number(resource.user_id) === Number(me.id)) return;
    appendResource(resource);
  });

  // Whiteboard updated by someone else — fetch from server (Pusher 10KB limit prevents sending image data)
  let _wbLoadTimer;
  channel.bind('whiteboard-update', (payload) => {
    const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
    if (Number(payload.updated_by) === Number(me.id)) return;
    clearTimeout(_wbLoadTimer);
    _wbLoadTimer = setTimeout(() => { if (typeof loadWb === 'function') loadWb(); }, 1500);
  });

  // Timer synced by host
  channel.bind('timer-sync', (data) => {
    const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
    if (Number(data.by) === Number(me.id)) return;
    if (typeof applyTimerSync === 'function') applyTimerSync(data);
  });

  // Host transferred
  channel.bind('host-changed', (data) => {
    window._roomHostId = data.new_host_id;
    if (typeof applyTimerOwnership === 'function') applyTimerOwnership();
    fetch(`/api/rooms/${roomId}/members`, { credentials: 'include' })
      .then(r => r.json()).then(({ members }) => renderMembers(members || []));
  });
}

function showTypingBadge(text, ms) {
  let badge = document.getElementById('typingBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'typingBadge';
    badge.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,20,50,0.9);color:#a78bfa;padding:6px 14px;border-radius:20px;font-size:12px;z-index:999;pointer-events:none;backdrop-filter:blur(8px);border:1px solid rgba(167,139,250,0.3)';
    document.body.appendChild(badge);
  }
  badge.textContent = text;
  badge.style.display = 'block';
  clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => { badge.style.display = 'none'; }, ms);
}

function appendMessage(msg) {
  const list = document.getElementById('chatMessages');
  if (!list) return;
  const emptyMsg = list.querySelector('p');
  if (emptyMsg) emptyMsg.remove();
  const msgColors = ['linear-gradient(135deg,#7c3aed,#ec4899)','linear-gradient(135deg,#06b6d4,#3b82f6)','linear-gradient(135deg,#f97316,#eab308)','linear-gradient(135deg,#22c55e,#06b6d4)'];
  const color   = msgColors[list.children.length % msgColors.length];
  const initial = (msg.sender_name || 'U').charAt(0).toUpperCase();
  const time    = new Date(msg.created_at || Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const safe    = (msg.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeName = (msg.sender_name || 'Unknown').replace(/</g,'&lt;');
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<div class="msg-av" style="background:${color}">${initial}</div><div class="msg-body"><div class="msg-meta"><span class="msg-name">${safeName}</span><span class="msg-time"> ${time}</span></div><div class="msg-text">${safe}</div></div>`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}

function renderMessages(messages) {
  const list = document.getElementById('chatMessages');
  if (!list) return;
  if (!messages.length) {
    list.innerHTML = '<p style="color:#3d3555;font-size:13px;text-align:center;padding:24px 0">No messages yet. Say hello!</p>';
    return;
  }
  const msgColors = ['linear-gradient(135deg,#7c3aed,#ec4899)','linear-gradient(135deg,#06b6d4,#3b82f6)','linear-gradient(135deg,#f97316,#eab308)','linear-gradient(135deg,#22c55e,#06b6d4)'];
  list.innerHTML = messages.map((m, i) => {
    const initial = (m.sender_name || 'U').charAt(0).toUpperCase();
    const color   = msgColors[i % msgColors.length];
    const time    = new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const safe    = (m.content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const safeName = (m.sender_name || 'Unknown').replace(/</g,'&lt;');
    return `
    <div class="msg">
      <div class="msg-av" style="background:${color}">${initial}</div>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-name">${safeName}</span><span class="msg-time"> ${time}</span></div>
        <div class="msg-text">${safe}</div>
      </div>
    </div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function renderMembers(members) {
  const list      = document.getElementById('memberList');
  const countEl   = document.getElementById('memberCount');
  if (!list) return;
  const grads = [
    'linear-gradient(135deg,#7c3aed,#ec4899)',
    'linear-gradient(135deg,#06b6d4,#3b82f6)',
    'linear-gradient(135deg,#f97316,#eab308)',
    'linear-gradient(135deg,#22c55e,#06b6d4)',
    'linear-gradient(135deg,#a855f7,#ec4899)',
  ];
  const me = JSON.parse(localStorage.getItem('ss_user') || '{}');
  const iAmHost = Number(me.id) === Number(window._roomHostId);
  list.innerHTML = members.map((m, i) => {
    const name    = (m.first_name + ' ' + (m.last_name?.charAt(0) || '') + '.').trim();
    const initial = m.first_name.charAt(0).toUpperCase();
    const isMe    = Number(m.id) === Number(me.id);
    const display = isMe ? 'You' : name;
    const makeOwnerBtn = (iAmHost && !isMe)
      ? `<button onclick="transferHost(${m.id})" title="Transfer room ownership" style="margin-left:auto;background:none;border:1px solid rgba(167,139,250,0.4);color:#a78bfa;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer;">Make Owner</button>`
      : '';
    return `<div class="member" data-member-id="${m.id}" style="display:flex;align-items:center;gap:8px">
      <div style="position:relative;flex-shrink:0">
        <div class="member-av" style="background:${grads[i % grads.length]}">${initial}</div>
        <div class="room-presence-dot ${m.presence||'offline'}" style="position:absolute;bottom:-1px;right:-1px;width:9px;height:9px;border-radius:50%;border:2px solid #0d0b1a"></div>
      </div>
      <div style="flex:1;min-width:0"><div class="member-name">${display}</div><div class="member-role">${m.role}</div></div>
      ${makeOwnerBtn}
    </div>`;
  }).join('');
  if (countEl) countEl.textContent = members.length + ' Live';
}

/* ── File type helpers ── */
const FILE_TYPES = {
  pdf:  { color: '#f87171', label: 'PDF' },
  doc:  { color: '#60a5fa', label: 'DOC' },
  docx: { color: '#60a5fa', label: 'DOCX' },
  xls:  { color: '#4ade80', label: 'XLS' },
  xlsx: { color: '#4ade80', label: 'XLSX' },
  ppt:  { color: '#fb923c', label: 'PPT' },
  pptx: { color: '#fb923c', label: 'PPTX' },
  png:  { color: '#67e8f9', label: 'PNG' },
  jpg:  { color: '#67e8f9', label: 'JPG' },
  jpeg: { color: '#67e8f9', label: 'JPG' },
  gif:  { color: '#67e8f9', label: 'GIF' },
  webp: { color: '#67e8f9', label: 'WEBP' },
  txt:  { color: '#94a3b8', label: 'TXT' },
  md:   { color: '#94a3b8', label: 'MD' },
  csv:  { color: '#4ade80', label: 'CSV' },
  zip:  { color: '#fde68a', label: 'ZIP' },
  rar:  { color: '#fde68a', label: 'RAR' },
};

function getFileInfo(type) {
  return FILE_TYPES[(type || 'link').toLowerCase()] || { color: '#a78bfa', label: (type || 'FILE').toUpperCase().slice(0, 4) };
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function renderResources(resources) {
  const list = document.querySelector('#tab-resources .resources');
  const countEl = document.getElementById('resCount');
  if (!list) return;
  if (countEl) countEl.textContent = resources.length ? `${resources.length} file${resources.length !== 1 ? 's' : ''}` : '';

  if (!resources.length) {
    list.innerHTML = '<p class="empty-msg" style="color:#3d3555;font-size:13px;text-align:center;padding:16px 0">No files shared yet</p>';
    return;
  }

  const viewable = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'csv']);

  list.innerHTML = resources.map(r => {
    const info = getFileInfo(r.file_type);
    const size = formatBytes(r.file_size);
    const canView = viewable.has((r.file_type || '').toLowerCase());
    const safeTitle = r.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeBy    = (r.shared_by || 'Unknown').replace(/</g, '&lt;');
    return `
    <div class="res-item">
      <div class="res-icon-wrap" style="background:${info.color}18;border-color:${info.color}30;flex-shrink:0">
        <span style="font-size:9px;font-weight:800;color:${info.color};letter-spacing:.5px">${info.label}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="res-title" title="${safeTitle}">${safeTitle}</div>
        <div class="res-by">${safeBy}${size ? ' · ' + size : ''}</div>
      </div>
      ${canView
        ? `<a class="res-dl" href="${r.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
             Open
           </a>`
        : `<a class="res-dl" href="${r.url}" download="${safeTitle}" onclick="event.stopPropagation()">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
             Download
           </a>`
      }
    </div>`;
  }).join('');
}

function appendResource(r) {
  const list = document.querySelector('#tab-resources .resources');
  const countEl = document.getElementById('resCount');
  if (!list) return;
  const emptyMsg = list.querySelector('p.empty-msg');
  if (emptyMsg) emptyMsg.remove();
  const info = getFileInfo(r.file_type);
  const safeTitle = (r.title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const safeBy = (r.shared_by || 'Unknown').replace(/</g,'&lt;');
  const viewable = new Set(['pdf','png','jpg','jpeg','gif','webp','txt','md','csv']);
  const canView = viewable.has((r.file_type || '').toLowerCase());
  const div = document.createElement('div');
  div.className = 'res-item';
  div.innerHTML = `
    <div class="res-icon-wrap" style="background:${info.color}18;border-color:${info.color}30;flex-shrink:0">
      <span style="font-size:9px;font-weight:800;color:${info.color};letter-spacing:.5px">${info.label}</span>
    </div>
    <div style="flex:1;min-width:0">
      <div class="res-title" title="${safeTitle}">${safeTitle}</div>
      <div class="res-by">${safeBy}</div>
    </div>
    ${canView
      ? `<a class="res-dl" href="${r.url}" target="_blank" rel="noopener">Open</a>`
      : `<a class="res-dl" href="${r.url}" download="${safeTitle}">Download</a>`}
  `;
  list.prepend(div);
  if (countEl) {
    const cur = parseInt(countEl.textContent) || 0;
    countEl.textContent = `${cur + 1} file${cur + 1 !== 1 ? 's' : ''}`;
  }
  showTypingBadge('New resource shared!', 3000);
}

/* ── File upload ── */
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZone')?.classList.add('drag-over');
}
function handleDragLeave(e) {
  e.preventDefault();
  document.getElementById('uploadZone')?.classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('uploadZone')?.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) uploadFiles(files);
}
function handleFileSelect(e) {
  const files = Array.from(e.target.files || []);
  if (files.length) uploadFiles(files);
  e.target.value = '';
}

async function uploadFiles(files) {
  const roomId = new URLSearchParams(window.location.search).get('id');
  if (!roomId) return;
  for (const file of files) await uploadSingleFile(file, roomId);
}

function uploadSingleFile(file, roomId) {
  return new Promise(resolve => {
    const progressWrap = document.getElementById('uploadProgressWrap');
    const progressName = document.getElementById('uploadProgressName');
    const progressBar  = document.getElementById('uploadBar');

    if (progressWrap) { progressWrap.style.display = 'block'; }
    if (progressName) progressName.textContent = `Uploading ${file.name}…`;
    if (progressBar)  progressBar.style.width = '0%';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${roomId}/resources`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && progressBar)
        progressBar.style.width = Math.round(e.loaded / e.total * 100) + '%';
    };

    xhr.onload = () => {
      if (progressBar) progressBar.style.width = '100%';
      setTimeout(() => { if (progressWrap) progressWrap.style.display = 'none'; }, 600);
      if (xhr.status >= 400) {
        try { showToast('❌', JSON.parse(xhr.responseText).error || 'Upload failed'); } catch {}
      }
      resolve();
    };
    xhr.onerror = () => {
      showToast('❌', 'Upload failed');
      if (progressWrap) progressWrap.style.display = 'none';
      resolve();
    };
    xhr.send(formData);
  });
}

async function sendMessage() {
  const input  = document.getElementById('chatInputField');
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('id');
  if (!input?.value?.trim() || !roomId) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/messages`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: input.value.trim() })
    });
    const data = await res.json();
    if (res.ok) {
      input.value = '';
      appendMessage(data.message);
    }
  } catch(e) { showToast('❌','Failed to send'); }
}

async function transferHost(memberId) {
  const roomId = new URLSearchParams(window.location.search).get('id');
  if (!confirm('Make this person the room owner?')) return;
  try {
    const res = await fetch(`/api/rooms/${roomId}/transfer-host`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_host_id: memberId })
    });
    if (!res.ok) { const d = await res.json(); showToast('❌', d.error || 'Failed'); }
  } catch(e) { showToast('❌', 'Failed to transfer'); }
}

/* Init */
document.addEventListener('DOMContentLoaded', async () => {
  addMeshBg();
  applyGlassSpotlight();
  initSpotlight();
  initFadeUp();

  const path = window.location.pathname;

  // Protected pages — verify auth before loading
  if (path.includes('dashboard') || path.includes('room')) {
    const user = await checkAuth();
    if (!user) return; // checkAuth already redirected
  }

  if (path.includes('dashboard')) {
    loadDashboard();
  }

  if (path.includes('room')) {
    fetch('/api/config').then(r=>r.json()).then(cfg=>{
      window.PUSHER_KEY     = cfg.pusherKey;
      window.PUSHER_CLUSTER = cfg.pusherCluster;
    }).catch(()=>{}).finally(() => loadRoom());
    const chatInput = document.getElementById('chatInputField');
    if (chatInput) {
      let _typingSent = false;
      chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { sendMessage(); _typingSent = false; return; }
        if (!_typingSent) {
          _typingSent = true;
          const roomId = new URLSearchParams(window.location.search).get('id');
          fetch(`/api/rooms/${roomId}/typing`, { method: 'POST', credentials: 'include' }).catch(()=>{});
          setTimeout(() => { _typingSent = false; }, 2000);
        }
      });
    }
  }
});