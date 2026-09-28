(function(){
  'use strict';

  function dataUrlToBytes(dataUrl){
    const text=String(dataUrl||'');
    const comma=text.indexOf(',');
    if(comma<0)throw new Error('Invalid image data URL');
    const head=text.slice(0,comma);
    const body=text.slice(comma+1);
    if(/;base64/i.test(head)){
      const bin=atob(body);
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  }

  function bytesToDataUrl(bytes,type='image/png'){
    let bin='';
    const chunk=0x8000;
    for(let i=0;i<bytes.length;i+=chunk){
      const part=bytes.subarray(i,Math.min(bytes.length,i+chunk));
      bin+=String.fromCharCode(...part);
    }
    return `data:${type};base64,${btoa(bin)}`;
  }

  async function blobToDataUrl(blob){
    const buffer=await blob.arrayBuffer();
    return bytesToDataUrl(new Uint8Array(buffer),blob.type||'image/png');
  }

  async function nativeDecode(buffer,onProgress){
    if(typeof ImageDecoder!=='function')return null;

    const decoder=new ImageDecoder({
      data:buffer,
      type:'image/gif',
      preferAnimation:true
    });

    try{
      await decoder.tracks.ready;
      const track=decoder.tracks.selectedTrack;
      const frameCount=Number(track?.frameCount)||0;
      onProgress?.(0, `Decoding ${frameCount} frame${frameCount===1?'':'s'}…`);
      if(frameCount<1)throw new Error('GIF contains no image frames');

      const first=await decoder.decode({frameIndex:0});
      const firstFrame=first.image;
      const width=firstFrame.displayWidth||firstFrame.codedWidth||1;
      const height=firstFrame.displayHeight||firstFrame.codedHeight||1;
      firstFrame.close?.();

      const canvas=document.createElement('canvas');
      canvas.width=width;
      canvas.height=height;
      const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:false});
      if(!ctx)throw new Error('Canvas 2D is unavailable');

      const frames=[];
      for(let i=0;i<frameCount;i++){
        const result=await decoder.decode({frameIndex:i,completeFramesOnly:true});
        const frame=result.image;
        const frameWidth=frame.displayWidth||frame.codedWidth||width;
        const frameHeight=frame.displayHeight||frame.codedHeight||height;

        if(canvas.width!==frameWidth||canvas.height!==frameHeight){
          canvas.width=frameWidth;
          canvas.height=frameHeight;
        }

        ctx.save();
        ctx.globalCompositeOperation='copy';
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(frame,0,0,canvas.width,canvas.height);
        ctx.restore();

        const png=await new Promise((resolve,reject)=>{
          canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not encode GIF frame as PNG')),'image/png');
        });

        frames.push({
          value:await blobToDataUrl(png),
          width:canvas.width,
          height:canvas.height,
          alphaPreserved:true,
          durationMs:Number.isFinite(frame.duration)?frame.duration/1000:null
        });

        frame.close?.();
        onProgress?.(((i+1)/frameCount)*100, `Decoded frame ${i+1} of ${frameCount}`);
        await new Promise(requestAnimationFrame);
      }

      return frames;
    }
    finally{
      decoder.close?.();
    }
  }

  /*
   * Kept as a compatibility fallback for browsers without ImageDecoder.
   * The normal path above intentionally follows the native browser GIF
   * decoder so frame disposal/transparency/compositing are handled by the
   * browser instead of duplicating GIF rendering behavior in JavaScript.
   */
  async function fallbackDecode(buffer){
    throw new Error('This browser does not support ImageDecoder for animated GIF import. Use a current Chromium/Edge browser or enable WebCodecs.');
  }

  async function convertArrayBufferToPngFrames(buffer,onProgress){
    if(!buffer)throw new Error('No GIF data supplied');
    const native=await nativeDecode(buffer,onProgress);
    if(native&&native.length)return native;
    return fallbackDecode(buffer);
  }

  async function convertDataUrlToPngFrames(dataUrl,onProgress){
    const bytes=dataUrlToBytes(dataUrl);
    return convertArrayBufferToPngFrames(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),onProgress);
  }

  async function convertFileToPngFrames(file,onProgress){
    return convertArrayBufferToPngFrames(await file.arrayBuffer(),onProgress);
  }

  window.UIXGifConvert={
    convertDataUrlToPngFrames,
    convertFileToPngFrames
  };
})();
