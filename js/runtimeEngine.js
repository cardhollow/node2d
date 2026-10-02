(() => {
  'use strict';

  const PI = Math.PI;
  const EPS = 1e-9;
  const DEG = PI / 180;
  const ENGINE_BUILD_VERSION = '40.0.12';

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
    const hasComponent=!!c;
    const detectable=hasComponent ? c.collidable !== false : false;
    const enabled=(hasComponent&&detectable)||(!hasComponent&&physics?.isCollider===true);
    if(!enabled) return null;
    const isStatic=!['Dynamic','Kinematic'].includes(physics?.body);
    const nt=body.t||{position:[0,0],scale:[1,1],angle:[0]};
    const ctKey=hasComponent&&c?.transform?c.transform:{position:[0,0],scale:[1,1],angle:[0]};
    const shapeKey=[Number(nt.position?.[0])||0,Number(nt.position?.[1])||0,Number(nt.scale?.[0]??1),Number(nt.scale?.[1]??1),Number(nt.angle?.[0])||0,hasComponent?String(c.shapeType||c.type||'Rect'):'Rect',Number(ctKey.position?.[0])||0,Number(ctKey.position?.[1])||0,Number(ctKey.scale?.[0]??1),Number(ctKey.scale?.[1]??1),Number(ctKey.angle?.[0])||0,hasComponent?(c.collidable===false?'0':'1'):'0',physics?.isCollider===true?'1':'0'].join('|');
    if(isStatic&&!body._shapeDirty&&body._shapeCache&&body._shapeKey===shapeKey)return body._shapeCache;

    const nx=Number(nt.position?.[0])||0, ny=Number(nt.position?.[1])||0;
    const nsx=Number(nt.scale?.[0] ?? 1), nsy=Number(nt.scale?.[1] ?? 1);
    const na=(Number(nt.angle?.[0])||0)*DEG;

    let type='Rect', lx=0, ly=0, la=0;
    let w=90*Math.abs(nsx), h=54*Math.abs(nsy);
    if(hasComponent){
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
    if(isStatic){body._shapeCache=shape;body._shapeKey=shapeKey;body._shapeDirty=false;}
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
    const ns=axes(poly.vertices);
    const cp=closestOnPolygon(poly,{x:circle.x,y:circle.y});
    const radial=sub(cp,{x:circle.x,y:circle.y});
    if(len(radial)>EPS)ns.push(norm(radial));
    let best={penetration:Infinity,normal:null};
    for(const n0 of ns){
      const n=norm(n0),pc=projectCircle(circle,n),pp=projectPoly(poly.vertices,n);
      const over=Math.min(pc.max,pp.max)-Math.max(pc.min,pp.min);
      if(over<=0)return null;
      if(over<best.penetration)best={penetration:over,normal:n};
    }
    let n=best.normal||{x:1,y:0};
    const centerTarget={x:Number(poly.x)||0,y:Number(poly.y)||0};
    const toward=sub(centerTarget,{x:Number(circle.x)||0,y:Number(circle.y)||0});
    if(len(toward)>EPS&&dot(toward,n)<0)n=mul(n,-1);
    if(flip)n=mul(n,-1);
    // Use the actual closest feature point as the contact point. Averaging the
    // polygon point with the circle support point can move the contact away from
    // the true normal and inject artificial torque, especially on slopes.
    const point=cp;
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
    const rawMass=Number(body.physics?.mass);const explicitMass=Number.isFinite(rawMass)&&rawMass>0?rawMass:0;const key=`${shape.type}|${shape.w}|${shape.h}|${shape.radius||0}|${body.physics.fixedRotation?'1':'0'}|${explicitMass}`;
    if(body._massKey===key&&body._massCache)return body._massCache;
    let mass, inertia;
    if(explicitMass>0){mass=explicitMass;inertia=mass*(shape.type==='Circle'?0.5*shape.radius*shape.radius:shape.type==='Triangle'?(shape.w*shape.w+shape.h*shape.h)/24:(shape.w*shape.w+shape.h*shape.h)/12);}
    else if(shape.type==='Circle'){mass=Math.PI*shape.radius*shape.radius*.001;inertia=.5*mass*shape.radius*shape.radius;}
    else if(shape.type==='Triangle'){mass=Math.max(.001,.5*shape.w*shape.h*.001);inertia=mass*(shape.w*shape.w+shape.h*shape.h)/24;}
    else{mass=Math.max(.001,shape.w*shape.h*.001);inertia=mass*(shape.w*shape.w+shape.h*shape.h)/12;}
    const safeMass=Math.max(.000001,mass);const safeInertia=Math.max(.0001,inertia);const out={mass:safeMass,invMass:1/safeMass,inertia:safeInertia,invInertia:body.physics?.fixedRotation?0:1/safeInertia};body._massKey=key;body._massCache=out;return out;
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
    const correction=Math.max(c.penetration-.01,0)*.5;
    if(correction<=0)return;
    const move=mul(c.normal,correction/total);
    if(c.ap.invMass){c.A.t.position[0]-=move.x*c.ap.invMass;c.A.t.position[1]-=move.y*c.ap.invMass;c.A._shapeDirty=true;}
    if(c.bp.invMass){c.B.t.position[0]+=move.x*c.bp.invMass;c.B.t.position[1]+=move.y*c.bp.invMass;c.B._shapeDirty=true;}
  }

  function syncTransformMotion(body,h,type){
    const t=body?.t;if(!t)return false;
    const px=Number(t.position?.[0])||0,py=Number(t.position?.[1])||0,pa=Number(t.angle?.[0])||0;
    if(!body._physicsPoseInitialized){
      body._physicsPoseInitialized=true;
      body._physicsPrevPosition=[px,py];
      body._physicsPrevAngle=pa;
      return false;
    }
    const prev=body._physicsPrevPosition||[px,py],prevAngle=Number(body._physicsPrevAngle)||0;
    const dx=px-prev[0],dy=py-prev[1],da=(pa-prevAngle)*DEG;
    const moved=Math.abs(dx)>1e-7||Math.abs(dy)>1e-7,rotated=Math.abs(da)>1e-7;
    if(!moved&&!rotated)return false;

    // A script, AI controller, or direct ctx.transform edit can move a body without
    // touching velocity. Treat that real transform delta as the motion for this step
    // so collision response reacts to what actually moved, not only to setVelocity().
    const inferredVx=dx/h,inferredVy=dy/h,inferredOmega=da/h;
    body.vx=Number.isFinite(inferredVx)?inferredVx:0;
    body.vy=Number.isFinite(inferredVy)?inferredVy:0;
    body.omega=Number.isFinite(inferredOmega)?inferredOmega:0;

    // Dynamic/Kinematic bodies will be integrated from the inferred motion. Restore
    // the last simulated pose first so the external transform change is not applied twice.
    if(type==='Dynamic'||type==='Kinematic'){
      t.position[0]=prev[0];
      t.position[1]=prev[1];
      t.angle[0]=prevAngle;
      body._shapeDirty=true;
    }
    return true;
  }

  function rememberPhysicsPose(body){
    const t=body?.t;if(!t)return;
    body._physicsPrevPosition=[Number(t.position?.[0])||0,Number(t.position?.[1])||0];
    body._physicsPrevAngle=Number(t.angle?.[0])||0;
    body._physicsPoseInitialized=true;
  }

  function jointMassProperties(body){
    const p=body?.physics;if(p?.body!=='Dynamic')return{invMass:0,invInertia:0};
    const shape=colliderShape(body)||{type:'Rect',w:90,h:54,radius:27};
    return massProps(body,shape);
  }
  function worldPoint(body,local){const t=body.t||{position:[0,0],angle:[0]};const a=(Number(t.angle?.[0])||0)*DEG;const q=rot(Number(local?.[0])||0,Number(local?.[1])||0,a);return{x:(Number(t.position?.[0])||0)+q.x,y:(Number(t.position?.[1])||0)+q.y};}
  function worldAxis(body){const a=(Number(body?.t?.angle?.[0])||0)*DEG;return{x:Math.cos(a),y:Math.sin(a)};}
  function jointAnchorVelocity(body,r){return pointVelocity(body,r);}
  function applyJointImpulse(body,impulse,r,sign,props){applyImpulse(body,impulse,r,sign,props);}
  function jointType(def){
    return ['Distance','Rope','Revolute','Prismatic','Weld','Wheel','Motor','Gear','Pulley','Friction'].includes(def?.type) ? def.type : 'Wheel';
  }
  function bodyPos(body){return{x:Number(body?.t?.position?.[0])||0,y:Number(body?.t?.position?.[1])||0};}
  function bodyAngle(body){return(Number(body?.t?.angle?.[0])||0)*DEG;}
  function angleDiff(a){return Math.atan2(Math.sin(a),Math.cos(a));}
  function applyAngularImpulse(body,impulse,sign,props){if(!props?.invInertia)return;body.omega=(Number(body.omega)||0)+impulse*props.invInertia*sign;}
  function solvePointConstraint(j,dt,softAxis=null){
    const A=j.bodyA,B=j.bodyB;const pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB);const pa=bodyPos(A),pb=bodyPos(B);const rA=sub(pA,pa),rB=sub(pB,pb);const ap=jointMassProperties(A),bp=jointMassProperties(B);if(ap.invMass===0&&bp.invMass===0)return;const err=sub(pB,pA);let axes=[{x:1,y:0},{x:0,y:1}];if(softAxis){const axis=norm(softAxis);axes=[perp(axis)];}
    for(const axis of axes){const rv=sub(jointAnchorVelocity(B,rB),jointAnchorVelocity(A,rA));const ra=cross(rA,axis),rb=cross(rB,axis);const k=ap.invMass+bp.invMass+ra*ra*ap.invInertia+rb*rb*bp.invInertia;if(k<=EPS)continue;const bias=clamp((dot(err,axis)*.22)/Math.max(dt,EPS),-60,60);const lambda=-(dot(rv,axis)+bias)/k;const imp=mul(axis,lambda);applyJointImpulse(A,imp,rA,-1,ap);applyJointImpulse(B,imp,rB,1,bp);}
  }
  function solveAngularConstraint(j,dt,targetAngle,softness=.22){
    const A=j.bodyA,B=j.bodyB;const ap=jointMassProperties(A),bp=jointMassProperties(B);const k=ap.invInertia+bp.invInertia;if(k<=EPS)return;const current=bodyAngle(B)-bodyAngle(A);const err=angleDiff(current-targetAngle);const rel=(Number(B.omega)||0)-(Number(A.omega)||0);const bias=clamp((err*softness)/Math.max(dt,EPS),-60,60);const lambda=-(rel+bias)/k;applyAngularImpulse(A,lambda,-1,ap);applyAngularImpulse(B,lambda,1,bp);}
  function solveDistance(j,dt){
    const A=j.bodyA,B=j.bodyB,pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB),delta=sub(pB,pA),d=len(delta),rest=Math.max(0,Number(j.def.distance)||0);if(d<=EPS)return;const axis=mul(delta,1/d),pa=bodyPos(A),pb=bodyPos(B),rA=sub(pA,pa),rB=sub(pB,pb),ap=jointMassProperties(A),bp=jointMassProperties(B),rv=sub(jointAnchorVelocity(B,rB),jointAnchorVelocity(A,rA)),ra=cross(rA,axis),rb=cross(rB,axis),k=ap.invMass+bp.invMass+ra*ra*ap.invInertia+rb*rb*bp.invInertia;if(k<=EPS)return;const err=d-rest,bias=clamp((err*.22)/Math.max(dt,EPS),-60,60),lambda=-(dot(rv,axis)+bias)/k,imp=mul(axis,lambda);applyJointImpulse(A,imp,rA,-1,ap);applyJointImpulse(B,imp,rB,1,bp);
  }
  function solveRope(j,dt){
    const A=j.bodyA,B=j.bodyB,pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB),delta=sub(pB,pA),d=len(delta),max=Math.max(0,Number(j.def.maxLength)||0);if(d<=max+1e-8||d<=EPS)return;const axis=mul(delta,1/d),pa=bodyPos(A),pb=bodyPos(B),rA=sub(pA,pa),rB=sub(pB,pb),ap=jointMassProperties(A),bp=jointMassProperties(B),rv=sub(jointAnchorVelocity(B,rB),jointAnchorVelocity(A,rA)),ra=cross(rA,axis),rb=cross(rB,axis),k=ap.invMass+bp.invMass+ra*ra*ap.invInertia+rb*rb*bp.invInertia;if(k<=EPS)return;const err=d-max,bias=clamp((err*.3)/Math.max(dt,EPS),0,60),lambda=Math.min(0,-(dot(rv,axis)+bias)/k),imp=mul(axis,lambda);applyJointImpulse(A,imp,rA,-1,ap);applyJointImpulse(B,imp,rB,1,bp);
  }
  function solveWheelSpring(j,dt){
    const A=j.bodyA,B=j.bodyB;const pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB);const axis=norm(rot(Number(j.def.axis?.[0]??1),Number(j.def.axis?.[1]??0),bodyAngle(A)));const rA=sub(pA,bodyPos(A)),rB=sub(pB,bodyPos(B));const ap=jointMassProperties(A),bp=jointMassProperties(B);const axisErr=dot(sub(pB,pA),axis);const rv=dot(sub(jointAnchorVelocity(B,rB),jointAnchorVelocity(A,rA)),axis);const k=ap.invMass+bp.invMass+cross(rA,axis)**2*ap.invInertia+cross(rB,axis)**2*bp.invInertia;if(k<=EPS)return;const freq=Math.max(0,Number(j.def.frequency)||0),damp=Math.max(0,Math.min(1,Number(j.def.dampingRatio)||0));const omega=2*Math.PI*freq;const stiffness=omega*omega;const damping=2*damp*omega;const impulse=-(stiffness*axisErr+damping*rv)*dt/k;const imp=mul(axis,impulse);applyJointImpulse(A,imp,rA,-1,ap);applyJointImpulse(B,imp,rB,1,bp);
  }
  function solvePrismatic(j,dt){
    const A=j.bodyA,B=j.bodyB;const axis=norm(rot(Number(j.def.axis?.[0]??1),Number(j.def.axis?.[1]??0),bodyAngle(A)));solvePointConstraint(j,dt,axis);solveAngularConstraint(j,dt,0,.18);
  }
  function solveWeld(j,dt){
    solvePointConstraint(j,dt);solveAngularConstraint(j,dt,Number(j.def.referenceAngle)||0,.28);
  }
  function solveMotor(j,dt){
    const A=j.bodyA,B=j.bodyB;const target=worldPoint(A,j.def.linearOffset||[0,0]);const oldA=j.anchorA;j.anchorA=[0,0];j.anchorB=[0,0];const temp={bodyA:A,bodyB:B,anchorA:[0,0],anchorB:[0,0]};const pB=worldPoint(B,[0,0]),delta=sub(pB,target),pa=bodyPos(A),pb=bodyPos(B),rA=sub(target,pa),rB=sub(pB,pb),ap=jointMassProperties(A),bp=jointMassProperties(B),axis=norm(delta),k=ap.invMass+bp.invMass; if(k>EPS&&len(delta)>EPS){const rv=sub(pointVelocity(B,rB),pointVelocity(A,rA));let lambda=-(dot(rv,axis)+clamp(dot(delta,axis)*Number(j.def.correctionFactor??.3)/Math.max(dt,EPS),-60,60))/k;lambda=clamp(lambda,-Math.max(0,Number(j.def.maxForce)||0),Math.max(0,Number(j.def.maxForce)||0));const imp=mul(axis,lambda);applyJointImpulse(A,imp,rA,-1,ap);applyJointImpulse(B,imp,rB,1,bp);} solveAngularConstraint({bodyA:A,bodyB:B,def:{},anchorA:[0,0],anchorB:[0,0]},dt,Number(j.def.angularOffset)||0,.18);j.anchorA=oldA;
  }
  function solveFriction(j,dt){
    const A=j.bodyA,B=j.bodyB,ap=jointMassProperties(A),bp=jointMassProperties(B),k=ap.invMass+bp.invMass;if(k<=EPS)return;const rv=sub({x:Number(B.vx)||0,y:Number(B.vy)||0},{x:Number(A.vx)||0,y:Number(A.vy)||0});const maxF=Math.max(0,Number(j.def.maxForce)||0),imp=mul(rv,-1/k);const mag=len(imp),scaled=mag>maxF*dt&&mag>EPS?mul(imp,(maxF*dt)/mag):imp;applyJointImpulse(A,scaled,[0,0],-1,ap);applyJointImpulse(B,scaled,[0,0],1,bp);const maxT=Math.max(0,Number(j.def.maxTorque)||0),rel=(Number(B.omega)||0)-(Number(A.omega)||0),tk=ap.invInertia+bp.invInertia;if(tk>EPS){const ti=clamp(-rel/tk,-maxT*dt,maxT*dt);applyAngularImpulse(A,ti,-1,ap);applyAngularImpulse(B,ti,1,bp);}}
  function solveGear(j,dt){
    const A=j.bodyA,B=j.bodyB,ratio=Number(j.def.ratio)||1;const ap=jointMassProperties(A),bp=jointMassProperties(B),k=ap.invInertia+ratio*ratio*bp.invInertia;if(k<=EPS)return;const err=angleDiff(bodyAngle(A)+ratio*bodyAngle(B)-(Number(j.def.referenceAngle)||0));const vel=(Number(A.omega)||0)+ratio*(Number(B.omega)||0),lambda=-(vel+clamp(err*.2/Math.max(dt,EPS),-60,60))/k;applyAngularImpulse(A,lambda,-1,ap);applyAngularImpulse(B,lambda*ratio,-1,bp);
  }
  function solvePulley(j,dt){
    const A=j.bodyA,B=j.bodyB,ga=j.def.groundA||[-100,0],gb=j.def.groundB||[100,0],pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB),a=sub(pA,{x:Number(ga[0])||0,y:Number(ga[1])||0}),b=sub(pB,{x:Number(gb[0])||0,y:Number(gb[1])||0}),la=len(a),lb=len(b),ratio=Number(j.def.ratio)||1,constant=Number(j.def.constant)||0;if(la<=EPS||lb<=EPS)return;const total=la+ratio*lb;const err=total-constant;const axisA=mul(a,1/la),axisB=mul(b,1/lb),ap=jointMassProperties(A),bp=jointMassProperties(B),ra=cross(sub(pA,bodyPos(A)),axisA),rb=cross(sub(pB,bodyPos(B)),axisB),k=ap.invMass+bp.invMass+ra*ra*ap.invInertia+ratio*ratio*(bp.invMass+rb*rb*bp.invInertia);if(k<=EPS)return;const rv=dot(jointAnchorVelocity(A,sub(pA,bodyPos(A))),axisA)+ratio*dot(jointAnchorVelocity(B,sub(pB,bodyPos(B))),axisB),lambda=-(rv+clamp(err*.22/Math.max(dt,EPS),-60,60))/k,impA=mul(axisA,lambda),impB=mul(axisB,lambda*ratio);applyJointImpulse(A,impA,sub(pA,bodyPos(A)),1,ap);applyJointImpulse(B,impB,sub(pB,bodyPos(B)),1,bp);
  }
  function solveJoint(j,dt){
    if(!j?.bodyA||!j?.bodyB)return;
    const type=jointType(j.def);
    if(type==='Revolute'){j.anchorA=j.def.parent||[0,0];j.anchorB=j.def.child||[0,0];solvePointConstraint(j,dt);return;}
    if(type==='Wheel'){j.anchorA=j.def.anchorA||[0,0];j.anchorB=j.def.anchorB||[0,0];solvePointConstraint(j,dt,rot(Number(j.def.axis?.[0]??1),Number(j.def.axis?.[1]??0),bodyAngle(j.bodyA)));solveWheelSpring(j,dt);return;}
    if(type==='Distance'){solveDistance(j,dt);return;}
    if(type==='Rope'){solveRope(j,dt);return;}
    if(type==='Prismatic'){solvePrismatic(j,dt);return;}
    if(type==='Weld'){solveWeld(j,dt);return;}
    if(type==='Motor'){solveMotor(j,dt);return;}
    if(type==='Gear'){solveGear(j,dt);return;}
    if(type==='Pulley'){solvePulley(j,dt);return;}
    if(type==='Friction'){solveFriction(j,dt);return;}
  }
  function solveJointPositions(j){
    const A=j.bodyA,B=j.bodyB;if(!A||!B)return;const type=jointType(j.def),ap=jointMassProperties(A),bp=jointMassProperties(B);if(ap.invMass===0&&bp.invMass===0)return;
    if(type==='Revolute'||type==='Weld'){
      j.anchorA=type==='Revolute'?(j.def.parent||[0,0]):(j.def.anchorA||[0,0]);j.anchorB=type==='Revolute'?(j.def.child||[0,0]):(j.def.anchorB||[0,0]);const pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB),err=sub(pB,pA),total=ap.invMass+bp.invMass;if(total>EPS){const c=mul(err,.9/total);if(ap.invMass){A.t.position[0]+=c.x*ap.invMass;A.t.position[1]+=c.y*ap.invMass;A._shapeDirty=true;}if(bp.invMass){B.t.position[0]-=c.x*bp.invMass;B.t.position[1]-=c.y*bp.invMass;B._shapeDirty=true;}}if(type==='Weld'){const target=Number(j.def.referenceAngle)||0,ea=angleDiff(bodyAngle(B)-bodyAngle(A)-target),den=ap.invInertia+bp.invInertia;if(den>EPS){if(ap.invInertia)A.t.angle[0]-=ea*(ap.invInertia/den)/DEG;if(bp.invInertia)B.t.angle[0]+=ea*(bp.invInertia/den)/DEG;A._shapeDirty=true;B._shapeDirty=true;}}return;
    }
    if(type==='Wheel'||type==='Prismatic'){
      j.anchorA=j.def.anchorA||[0,0];j.anchorB=j.def.anchorB||[0,0];const pA=worldPoint(A,j.anchorA),pB=worldPoint(B,j.anchorB),axis=norm(rot(Number(j.def.axis?.[0]??1),Number(j.def.axis?.[1]??0),bodyAngle(A))),n=perp(axis),err=dot(sub(pB,pA),n),total=ap.invMass+bp.invMass;if(total>EPS&&Math.abs(err)>1e-8){const c=mul(n,err*.9/total);if(ap.invMass){A.t.position[0]+=c.x*ap.invMass;A.t.position[1]+=c.y*ap.invMass;A._shapeDirty=true;}if(bp.invMass){B.t.position[0]-=c.x*bp.invMass;B.t.position[1]-=c.y*bp.invMass;B._shapeDirty=true;}}return;
    }
    if(type==='Distance'||type==='Rope'){
      const pA=worldPoint(A,j.def.anchorA||[0,0]),pB=worldPoint(B,j.def.anchorB||[0,0]),dvec=sub(pB,pA),d=len(dvec);if(d<=EPS)return;const target=type==='Distance'?Math.max(0,Number(j.def.distance)||0):Math.min(d,Math.max(0,Number(j.def.maxLength)||0));if(type==='Rope'&&d<=target+1e-8)return;const c=mul(norm(dvec),(d-target)*.9/(Math.max(ap.invMass+bp.invMass,EPS)));if(ap.invMass){A.t.position[0]+=c.x*ap.invMass;A.t.position[1]+=c.y*ap.invMass;A._shapeDirty=true;}if(bp.invMass){B.t.position[0]-=c.x*bp.invMass;B.t.position[1]-=c.y*bp.invMass;B._shapeDirty=true;}return;
    }
    if(type==='Pulley'){return;}
    if(type==='Gear'){const ratio=Number(j.def.ratio)||1,ref=Number(j.def.referenceAngle)||0,err=angleDiff(bodyAngle(A)+ratio*bodyAngle(B)-ref),den=Math.max(ap.invInertia+ratio*ratio*bp.invInertia,EPS);if(Math.abs(err)>1e-7){if(ap.invInertia)A.t.angle[0]-=err*(ap.invInertia/den)/DEG;if(bp.invInertia)B.t.angle[0]-=err*(ratio*bp.invInertia/den)/DEG;A._shapeDirty=true;B._shapeDirty=true;}return;}
    if(type==='Motor'){return;}
    if(type==='Friction'){return;}
  }

  function stepPhysics(bodies,dt,onCollisions,joints=[]){
    const h=Math.min(Math.max(Number(dt)||0,0),1/30);
    if(h<=0)return 0;

    const shapes=new Array(bodies.length),aabbs=new Array(bodies.length),props=new Array(bodies.length),entries=[];
    for(let i=0;i<bodies.length;i++){
      const b=bodies[i];b.colliding=false;const type=b.physics?.body;
      syncTransformMotion(b,h,type);
      if(type==='Dynamic')b.vy=(Number(b.vy)||0)+(Number(b.physics?.gravity)||0)*h;
      if(type==='Dynamic'||type==='Kinematic'){b.t.position[0]+=(Number(b.vx)||0)*h;b.t.position[1]+=(Number(b.vy)||0)*h;if(type==='Dynamic'&&!b.physics?.fixedRotation)b.t.angle[0]+=(Number(b.omega)||0)*h/DEG;b._shapeDirty=true;}
      const shape=colliderShape(b);shapes[i]=shape;if(!shape)continue;const isStatic=!['Dynamic','Kinematic'].includes(type);const cacheValid=isStatic&&b._aabbCache&&!b._shapeDirty&&b._aabbCacheKey===b._shapeKey;const box=cacheValid?b._aabbCache:aabb(shape);if(isStatic){b._aabbCache=box;b._aabbCacheKey=b._shapeKey;}aabbs[i]=box;props[i]=massProps(b,shape);entries.push(i);
    }

    // Sweep-and-prune broadphase: only pairs whose AABBs overlap on X are tested further.
    entries.sort((i,j)=>aabbs[i].l-aabbs[j].l);
    const contacts=[],detectedPairs=[];
    for(let ai=0;ai<entries.length;ai++){
      const i=entries[ai],A=shapes[i],aa=aabbs[i];
      for(let aj=ai+1;aj<entries.length;aj++){
        const j=entries[aj],bb=aabbs[j];
        if(bb.l>aa.r)break;
        if(aa.r<bb.l||aa.l>bb.r||aa.b<bb.t||aa.t>bb.b)continue;
        const hit=collide(A,shapes[j]);if(!hit)continue;
        // Collider components decide what is detectable. Physics.isCollider only
        // decides whether a detected pair participates in physical response.
        bodies[i].colliding=true;bodies[j].colliding=true;detectedPairs.push([bodies[i],bodies[j]]);
        if(!(bodies[i].physics?.isCollider===true&&bodies[j].physics?.isCollider===true))continue;
        const ap=props[i],bp=props[j];if(ap.invMass===0&&bp.invMass===0)continue;
        contacts.push({A:bodies[i],B:bodies[j],normal:norm(hit.normal),penetration:hit.penetration,points:hit.points,ap,bp,friction:Math.sqrt(Math.max(0,Number(bodies[i].physics?.friction)||0)*Math.max(0,Number(bodies[j].physics?.friction)||0)),restitution:clamp(Math.max(Number(bodies[i].physics?.bounciness)||0,Number(bodies[j].physics?.bounciness)||0),0,1)});
      }
    }

    // Fewer solver passes are enough with the cached broadphase/manifold data and avoid
    // multiplying collision work unnecessarily when several objects touch at once.
    for(let iter=0;iter<8;iter++){for(const c of contacts)solveContact(c);for(const j of joints||[])solveJoint(j,h);}
    for(const j of joints||[])solveJointPositions(j);
    for(let iter=0;iter<2;iter++)for(const c of contacts)positionalCorrection(c);

    for(const b of bodies){
      if(!Number.isFinite(b.vx))b.vx=0;if(!Number.isFinite(b.vy))b.vy=0;if(!Number.isFinite(b.omega))b.omega=0;
      const maxSpeed=3000,sp=Math.hypot(b.vx,b.vy);if(sp>maxSpeed){const k=maxSpeed/sp;b.vx*=k;b.vy*=k;}
      const maxOmega=Number.isFinite(Number(b.physics?.maxAngularVelocity))&&Number(b.physics?.maxAngularVelocity)>0?Number(b.physics.maxAngularVelocity):60;
      if(Math.abs(b.omega)>maxOmega)b.omega=Math.sign(b.omega)*maxOmega;
      if(b.physics?.fixedRotation)b.omega=0;
      rememberPhysicsPose(b);
    }
    if(typeof onCollisions==='function'&&detectedPairs.length)onCollisions(detectedPairs.map(pair=>[pair[0],pair[1]]));
    return contacts.length;
  }

  async function prepareMicrophone(gameSettings={}){
    if(gameSettings?.requirements?.['Use Mic']!==true)return null;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access is not available in this browser or context');
    return navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  }

  window.UIXRuntimeEngine={version:ENGINE_BUILD_VERSION,stepPhysics,colliderShape,collide,prepareMicrophone};

})();
