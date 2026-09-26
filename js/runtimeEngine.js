(() => {
  'use strict';

  const PI = Math.PI;
  const EPS = 1e-9;
  const DEG = PI / 180;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y});
  const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
  const mul = (a,s) => ({x:a.x*s,y:a.y*s});
  const dot = (a,b) => a.x*b.x+a.y*b.y;
  const cross = (a,b) => a.x*b.y-a.y*b.x;
  const crossSV = (s,v) => ({x:-s*v.y,y:s*v.x});
  const len = a => Math.hypot(a.x,a.y);
  const norm = a => { const l=len(a); return l>EPS ? mul(a,1/l) : {x:1,y:0}; };
  const perp = a => ({x:-a.y,y:a.x});
  const rot = (x,y,a) => ({x:x*Math.cos(a)-y*Math.sin(a),y:x*Math.sin(a)+y*Math.cos(a)});

  function colliderShape(body){
    const c=body?.collider;
    const physics=body?.physics;
    const detectable=!!c && c.collidable !== false;
    const physical=physics?.isCollider===true;
    if(!detectable && !physical) return null;

    const nt=body.t||{position:[0,0],scale:[1,1],angle:[0]};
    const nx=Number(nt.position?.[0])||0, ny=Number(nt.position?.[1])||0;
    const nsx=Number(nt.scale?.[0] ?? 1), nsy=Number(nt.scale?.[1] ?? 1);
    const na=(Number(nt.angle?.[0])||0)*DEG;

    let type='Rect', lx=0, ly=0, la=0;
    let w=90*Math.abs(nsx), h=54*Math.abs(nsy);
    if(detectable){
      const ct=c.transform||{position:[0,0],scale:[1,1],angle:[0]};
      type=['Rect','Circle','Triangle'].includes(c.shapeType)?c.shapeType:'Rect';
      lx=(Number(ct.position?.[0])||0)*nsx;
      ly=(Number(ct.position?.[1])||0)*nsy;
      la=(Number(ct.angle?.[0])||0)*DEG;
      w=90*Math.abs(Number(ct.scale?.[0]??1)*nsx);
      h=54*Math.abs(Number(ct.scale?.[1]??1)*nsy);
    }
    const off=rot(lx,ly,na), x=nx+off.x, y=ny+off.y, angle=na+la;
    if(type==='Circle'){const d=Math.max(w,h);w=d;h=d;}
    const shape={type,x,y,angle,w:Math.max(.01,w),h:Math.max(.01,h),vertices:null,radius:null};
    if(type==='Circle') shape.radius=shape.w/2;
    else {
      const hw=shape.w/2, hh=shape.h/2;
      const local=type==='Triangle' ? [{x:0,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}] : [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
      shape.vertices=local.map(v=>{const q=rot(v.x,v.y,angle);return{x:x+q.x,y:y+q.y};});
    }
    return shape;
  }

  function aabb(s){
    if(s.type==='Circle') return {l:s.x-s.radius,r:s.x+s.radius,t:s.y-s.radius,b:s.y+s.radius};
    let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity;
    for(const v of s.vertices||[]){l=Math.min(l,v.x);r=Math.max(r,v.x);t=Math.min(t,v.y);b=Math.max(b,v.y);}
    return {l,r,t,b};
  }

  function axes(vertices){
    const out=[];
    for(let i=0;i<vertices.length;i++){
      const e=sub(vertices[(i+1)%vertices.length],vertices[i]);
      const n=norm(perp(e));
      if(!out.some(a=>Math.abs(dot(a,n))>.99999)) out.push(n);
    }
    return out;
  }
  function projectPoly(vertices,n){let mn=Infinity,mx=-Infinity;for(const v of vertices){const d=dot(v,n);mn=Math.min(mn,d);mx=Math.max(mx,d);}return{min:mn,max:mx};}
  function projectCircle(s,n){const d=dot({x:s.x,y:s.y},n);return{min:d-s.radius,max:d+s.radius};}
  function supportFeature(vertices,dir,tangent){
    let best=-Infinity;for(const v of vertices)best=Math.max(best,dot(v,dir));
    const pts=vertices.filter(v=>Math.abs(dot(v,dir)-best)<=1e-7).sort((a,b)=>dot(a,tangent)-dot(b,tangent));
    return pts.length?pts:[vertices[0]];
  }
  function pointOnFeature(points,tangent,target){
    if(points.length===1)return points[0];
    const a=points[0],b=points[points.length-1],da=dot(a,tangent),db=dot(b,tangent);
    if(Math.abs(db-da)<1e-9)return a;
    const u=clamp((target-da)/(db-da),0,1);
    return add(a,mul(sub(b,a),u));
  }

  function polyPoly(A,B){
    const allAxes=[...axes(A.vertices),...axes(B.vertices)];
    let best={penetration:Infinity,normal:null};
    for(const n0 of allAxes){
      const n=norm(n0),pa=projectPoly(A.vertices,n),pb=projectPoly(B.vertices,n),over=Math.min(pa.max,pb.max)-Math.max(pa.min,pb.min);
      if(over<=0)return null;
      if(over<best.penetration)best={penetration:over,normal:n};
    }
    const ca=A.vertices.reduce((p,v)=>add(p,v),{x:0,y:0});
    const cb=B.vertices.reduce((p,v)=>add(p,v),{x:0,y:0});
    const centerDelta=sub(cb,mul(ca,1/A.vertices.length));
    const cdb=mul(cb,1/B.vertices.length);
    if(dot(sub(cdb,mul(ca,1/A.vertices.length)),best.normal)<0) best.normal=mul(best.normal,-1);
    const n=best.normal,t=perp(n);
    const fa=supportFeature(A.vertices,n,t);
    const fb=supportFeature(B.vertices,mul(n,-1),t);
    const amin=Math.min(...fa.map(v=>dot(v,t))), amax=Math.max(...fa.map(v=>dot(v,t)));
    const bmin=Math.min(...fb.map(v=>dot(v,t))), bmax=Math.max(...fb.map(v=>dot(v,t)));
    const lo=Math.max(amin,bmin),hi=Math.min(amax,bmax);
    const points=[];
    if(hi>=lo-1e-7){
      const targets=Math.abs(hi-lo)<1e-6?[ (lo+hi)*.5 ]:[lo,hi];
      for(const target of targets){
        const pa=pointOnFeature(fa,t,target),pb=pointOnFeature(fb,t,target);
        points.push(mul(add(pa,pb),.5));
      }
    } else {
      points.push(mul(add(fa[Math.floor(fa.length/2)],fb[Math.floor(fb.length/2)]),.5));
    }
    return {normal:n,penetration:best.penetration,points};
  }

  function circleCircle(A,B){
    const dvec=sub({x:B.x,y:B.y},{x:A.x,y:A.y}),d=len(dvec),r=A.radius+B.radius;
    if(d>=r)return null;
    const n=d>EPS?mul(dvec,1/d):{x:1,y:0};
    return {normal:n,penetration:r-d,points:[add({x:A.x,y:A.y},mul(n,A.radius-(r-d)*.5))]};
  }
  function closestOnPolygon(poly,p){
    let best=poly.vertices[0],bestD=Infinity;
    for(let i=0;i<poly.vertices.length;i++){
      const a=poly.vertices[i],b=poly.vertices[(i+1)%poly.vertices.length],ab=sub(b,a),den=dot(ab,ab)||1,u=clamp(dot(sub(p,a),ab)/den,0,1),q=add(a,mul(ab,u)),d=dot(sub(q,p),sub(q,p));
      if(d<bestD){bestD=d;best=q;}
    }
    return best;
  }
  function circlePoly(circle,poly,flip=false){
    const ns=axes(poly.vertices);const cp=closestOnPolygon(poly,{x:circle.x,y:circle.y});const radial=sub(cp,{x:circle.x,y:circle.y});if(len(radial)>EPS)ns.push(norm(radial));
    let best={penetration:Infinity,normal:null};
    for(const n0 of ns){const n=norm(n0),pc=projectCircle(circle,n),pp=projectPoly(poly.vertices,n),over=Math.min(pc.max,pp.max)-Math.max(pc.min,pp.min);if(over<=0)return null;if(over<best.penetration)best={penetration:over,normal:n};}
    let n=best.normal;
    if(dot(sub({x:poly.x,y:poly.y},{x:circle.x,y:circle.y}),n)<0)n=mul(n,-1);
    if(flip)n=mul(n,-1);
    const point=flip?add({x:poly.x,y:poly.y},mul(n,-best.penetration*.5)):add({x:circle.x,y:circle.y},mul(n,circle.radius-best.penetration*.5));
    return {normal:n,penetration:best.penetration,points:[point]};
  }
  function collide(A,B){
    if(!A||!B)return null;
    if(A.type==='Circle'&&B.type==='Circle')return circleCircle(A,B);
    if(A.type==='Circle')return circlePoly(A,B,false);
    if(B.type==='Circle')return circlePoly(B,A,true);
    return polyPoly(A,B);
  }

  function massProps(body,shape){
    if(body.physics?.body!=='Dynamic')return{invMass:0,invInertia:0};
    let mass, inertia;
    if(shape.type==='Circle'){mass=Math.PI*shape.radius*shape.radius*.001;inertia=.5*mass*shape.radius*shape.radius;}
    else if(shape.type==='Triangle'){mass=Math.max(.001,.5*shape.w*shape.h*.001);inertia=mass*(shape.w*shape.w+shape.h*shape.h)/24;}
    else{mass=Math.max(.001,shape.w*shape.h*.001);inertia=mass*(shape.w*shape.w+shape.h*shape.h)/12;}
    return{invMass:1/mass,invInertia:body.physics?.fixedRotation?0:1/Math.max(inertia,.0001)};
  }
  function pointVelocity(body,r){return add({x:Number(body.vx)||0,y:Number(body.vy)||0},crossSV(Number(body.omega)||0,r));}
  function applyImpulse(body,imp,r,sign,props){if(props.invMass===0)return;body.vx=(Number(body.vx)||0)+imp.x*props.invMass*sign;body.vy=(Number(body.vy)||0)+imp.y*props.invMass*sign;body.omega=(Number(body.omega)||0)+cross(r,imp)*props.invInertia*sign;}

  function solveContact(c){
    const {A,B,normal:n,points,ap,bp,friction,restitution}=c;
    if(!points.length)return;
    const aPos=A.t.position||[0,0],bPos=B.t.position||[0,0];
    const contacts=points.slice(0,2).map(p=>{
      const ra=sub(p,{x:Number(aPos[0])||0,y:Number(aPos[1])||0});
      const rb=sub(p,{x:Number(bPos[0])||0,y:Number(bPos[1])||0});
      const rv=sub(pointVelocity(B,rb),pointVelocity(A,ra));
      const vn=dot(rv,n);
      return {p,ra,rb,vn,jn:0};
    });

    // Solve a two-point polygon contact as a small coupled manifold instead of
    // letting the first contact consume the whole impulse. That is important
    // for long bars resting on a surface: equal supporting contacts should not
    // manufacture torque and make the body stand up by itself.
    const m=contacts.length;
    const desired=contacts.map(c=>c.vn<-.75&&restitution>0 ? -restitution*c.vn : 0);
    const K=Array.from({length:m},()=>Array(m).fill(0));
    for(let i=0;i<m;i++){
      for(let j=0;j<m;j++){
        const raiN=cross(contacts[i].ra,n),rajN=cross(contacts[j].ra,n);
        const rbiN=cross(contacts[i].rb,n),rbjN=cross(contacts[j].rb,n);
        K[i][j]=ap.invMass+bp.invMass+raiN*rajN*ap.invInertia+rbiN*rbjN*bp.invInertia;
      }
    }
    if(m===1){
      contacts[0].jn=Math.max(0,(desired[0]-contacts[0].vn)/(K[0][0]||1));
    }else{
      const b0=desired[0]-contacts[0].vn,b1=desired[1]-contacts[1].vn;
      const det=K[0][0]*K[1][1]-K[0][1]*K[1][0];
      if(Math.abs(det)>1e-10){
        let j0=(b0*K[1][1]-K[0][1]*b1)/det;
        let j1=(K[0][0]*b1-b0*K[1][0])/det;
        if(j0>=0&&j1>=0){contacts[0].jn=j0;contacts[1].jn=j1;}
        else if(j0<0&&j1>=0){contacts[1].jn=Math.max(0,b1/(K[1][1]||1));}
        else if(j1<0&&j0>=0){contacts[0].jn=Math.max(0,b0/(K[0][0]||1));}
        else{
          contacts[0].jn=Math.max(0,b0/(K[0][0]||1));
          contacts[1].jn=Math.max(0,b1/(K[1][1]||1));
        }
      }else{
        contacts[0].jn=Math.max(0,b0/(K[0][0]||1));
        contacts[1].jn=Math.max(0,b1/(K[1][1]||1));
      }
    }

    // Apply all normal impulses together so the manifold does not create a
    // one-sided torque just because contact 0 happened to be solved first.
    for(const cpt of contacts){
      if(cpt.jn<=EPS)continue;
      const imp=mul(n,cpt.jn);
      applyImpulse(A,imp,cpt.ra,-1,ap);
      applyImpulse(B,imp,cpt.rb,1,bp);
    }

    // Friction is velocity based and is solved after the normal support forces.
    for(const cpt of contacts){
      if(cpt.jn<=EPS||friction<=0)continue;
      const rv=sub(pointVelocity(B,cpt.rb),pointVelocity(A,cpt.ra));
      const tangentV=sub(rv,mul(n,dot(rv,n)));const tl=len(tangentV);if(tl<=EPS)continue;
      const t=mul(tangentV,1/tl),raT=cross(cpt.ra,t),rbT=cross(cpt.rb,t);
      const td=ap.invMass+bp.invMass+raT*raT*ap.invInertia+rbT*rbT*bp.invInertia;
      if(td<=EPS)continue;
      const jt=clamp(-dot(rv,t)/td,-friction*cpt.jn,friction*cpt.jn);
      if(Math.abs(jt)>EPS){const imp=mul(t,jt);applyImpulse(A,imp,cpt.ra,-1,ap);applyImpulse(B,imp,cpt.rb,1,bp);}
    }
  }

  function positionalCorrection(c){
    const total=c.ap.invMass+c.bp.invMass;if(total<=EPS)return;
    const correction=Math.min(.75,Math.max(c.penetration-.15,0)*.22);
    if(correction<=0)return;
    const move=mul(c.normal,correction/total);
    if(c.ap.invMass){c.A.t.position[0]-=move.x*c.ap.invMass;c.A.t.position[1]-=move.y*c.ap.invMass;}
    if(c.bp.invMass){c.B.t.position[0]+=move.x*c.bp.invMass;c.B.t.position[1]+=move.y*c.bp.invMass;}
  }

  function stepPhysics(bodies,dt){
    const h=Math.min(Math.max(Number(dt)||0,0),1/30);
    if(h<=0)return;

    for(const b of bodies){
      b.colliding=false;
      const type=b.physics?.body;
      if(type==='Dynamic'){
        b.vy=(Number(b.vy)||0)+(Number(b.physics?.gravity)||0)*h;
      }
      if(type==='Dynamic'||type==='Kinematic'){
        b.t.position[0]+=(Number(b.vx)||0)*h;
        b.t.position[1]+=(Number(b.vy)||0)*h;
        if(type==='Dynamic'&&!b.physics?.fixedRotation)b.t.angle[0]+=(Number(b.omega)||0)*h/DEG;
      }
    }

    const contacts=[];
    for(let i=0;i<bodies.length;i++){
      const AShape=colliderShape(bodies[i]);if(!AShape)continue;const aa=aabb(AShape);
      for(let j=i+1;j<bodies.length;j++){
        const BShape=colliderShape(bodies[j]);if(!BShape)continue;const bb=aabb(BShape);
        if(aa.r<bb.l||aa.l>bb.r||aa.b<bb.t||aa.t>bb.b)continue;
        const hit=collide(AShape,BShape);if(!hit)continue;
        bodies[i].colliding=true;bodies[j].colliding=true;
        if(!(bodies[i].physics?.isCollider===true||bodies[j].physics?.isCollider===true))continue;
        const ap=massProps(bodies[i],AShape),bp=massProps(bodies[j],BShape);if(ap.invMass===0&&bp.invMass===0)continue;
        contacts.push({A:bodies[i],B:bodies[j],normal:norm(hit.normal),penetration:hit.penetration,points:hit.points,ap,bp,friction:Math.sqrt(Math.max(0,Number(bodies[i].physics?.friction)||0)*Math.max(0,Number(bodies[j].physics?.friction)||0)),restitution:clamp(Math.max(Number(bodies[i].physics?.bounciness)||0,Number(bodies[j].physics?.bounciness)||0),0,1)});
      }
    }

    for(let iter=0;iter<8;iter++)for(const c of contacts)solveContact(c);
    for(let iter=0;iter<3;iter++)for(const c of contacts)positionalCorrection(c);

    for(const b of bodies){
      if(!Number.isFinite(b.vx))b.vx=0;if(!Number.isFinite(b.vy))b.vy=0;if(!Number.isFinite(b.omega))b.omega=0;
      const maxSpeed=3000,s=Math.hypot(b.vx,b.vy);if(s>maxSpeed){const k=maxSpeed/s;b.vx*=k;b.vy*=k;}
      if(Math.abs(b.omega)>60)b.omega=Math.sign(b.omega)*60;
      if(b.physics?.fixedRotation)b.omega=0;
    }
    return contacts.length;
  }

  async function prepareMicrophone(gameSettings={}){
    if(gameSettings?.requirements?.['Use Mic']!==true)return null;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access is not available in this browser or context');
    return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  }

  window.UIXRuntimeEngine={stepPhysics,colliderShape,collide,prepareMicrophone};

})();
