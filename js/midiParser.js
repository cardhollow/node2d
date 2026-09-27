(() => {
  'use strict';

  const text = (bytes, start, length) => {
    let out = '';
    const end = Math.min(bytes.length, start + length);
    for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
    return out.replace(/\0/g, '').trim();
  };
  const u16 = (b, i) => ((b[i] << 8) | b[i + 1]) >>> 0;
  const u32 = (b, i) => (((b[i] << 24) >>> 0) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const readVLQ = (b, i) => {
    let value = 0, count = 0, x;
    do {
      if (i >= b.length || count++ > 4) throw new Error('Invalid MIDI variable-length value');
      x = b[i++];
      value = (value << 7) | (x & 0x7F);
    } while (x & 0x80);
    return { value, next: i };
  };
  const writeVLQ = value => {
    value = Math.max(0, Math.floor(Number(value) || 0));
    const out = [value & 0x7F];
    while ((value >>>= 7)) out.unshift((value & 0x7F) | 0x80);
    return out;
  };
  const u16w = v => [(v >> 8) & 255, v & 255];
  const u32w = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunk = (id, data) => [...id].map(c => c.charCodeAt(0)).concat(u32w(data.length), data);

  function parse(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    let pos = 0;
    if (b.length < 14 || text(b, 0, 4) !== 'MThd') throw new Error('Not a Standard MIDI File');
    const headerLength = u32(b, 4);
    if (headerLength < 6 || 8 + headerLength > b.length) throw new Error('Invalid MIDI header');
    const format = u16(b, 8);
    const trackCount = u16(b, 10);
    const division = u16(b, 12);
    pos = 8 + headerLength;

    const ppq = (division & 0x8000) ? 480 : (division & 0x7FFF) || 480;
    const tracks = [];
    const tempos = [];
    const timeSignatures = [];

    for (let trackIndex = 0; trackIndex < trackCount && pos + 8 <= b.length; trackIndex++) {
      if (text(b, pos, 4) !== 'MTrk') throw new Error('Invalid MIDI track chunk');
      const length = u32(b, pos + 4);
      pos += 8;
      const end = Math.min(b.length, pos + length);
      let tick = 0;
      let runningStatus = 0;
      let trackName = `Track ${trackIndex + 1}`;
      let trackChannel = 0;
      const open = new Map();
      const notes = [];

      while (pos < end) {
        const delta = readVLQ(b, pos);
        pos = delta.next;
        tick += delta.value;
        if (pos >= end) break;

        let status = b[pos];
        if (status & 0x80) {
          pos++;
          if (status < 0xF0) runningStatus = status;
        } else if (runningStatus) {
          status = runningStatus;
        } else {
          throw new Error('Invalid running status');
        }

        if (status === 0xFF) {
          if (pos >= end) break;
          const type = b[pos++];
          const vlq = readVLQ(b, pos);
          pos = vlq.next;
          const metaLen = vlq.value;
          if (pos + metaLen > end) throw new Error('Invalid MIDI meta event');
          if (type === 0x03) trackName = text(b, pos, metaLen) || trackName;
          else if (type === 0x51 && metaLen === 3) {
            const usPerQuarter = (b[pos] << 16) | (b[pos + 1] << 8) | b[pos + 2];
            if (usPerQuarter > 0) tempos.push({ tick, bpm: 60000000 / usPerQuarter });
          } else if (type === 0x58 && metaLen >= 2) {
            timeSignatures.push({ tick, numerator: b[pos], denominator: 2 ** b[pos + 1] });
          }
          pos += metaLen;
          continue;
        }
        if (status === 0xF0 || status === 0xF7) {
          const vlq = readVLQ(b, pos);
          pos = vlq.next + vlq.value;
          continue;
        }
        if (status >= 0xF1) {
          const systemLengths = { 0xF1: 1, 0xF2: 2, 0xF3: 1, 0xF6: 0 };
          const consume = systemLengths[status];
          if (consume === undefined) throw new Error('Unsupported MIDI system event');
          pos = Math.min(end, pos + consume);
          continue;
        }

        const hi = status >> 4;
        const channel = status & 0x0F;
        trackChannel = channel;
        if (pos >= end) break;
        const a = b[pos++];
        const needsTwo = hi !== 0xC && hi !== 0xD;
        const bb = needsTwo ? (pos < end ? b[pos++] : 0) : 0;
        const key = `${channel}:${a}`;

        if (hi === 0x9 && bb > 0) {
          const queue = open.get(key) || [];
          queue.push({ tick, velocity: bb });
          open.set(key, queue);
        } else if (hi === 0x8 || (hi === 0x9 && bb === 0)) {
          const queue = open.get(key);
          if (queue?.length) {
            const started = queue.shift();
            notes.push({ tick: started.tick, duration: Math.max(1, tick - started.tick), pitch: a, velocity: started.velocity, channel });
            if (!queue.length) open.delete(key);
          }
        }
      }

      for (const [key, queue] of open) {
        for (const started of queue) {
          const pitch = Number(key.split(':')[1]);
          notes.push({ tick: started.tick, duration: Math.max(1, ppq / 4), pitch, velocity: started.velocity, channel });
        }
      }

      tracks.push({ name: trackName, channel: trackChannel, notes: notes.sort((a, z) => a.tick - z.tick || a.pitch - z.pitch) });
      pos = end;
    }

    tempos.sort((a, b) => a.tick - b.tick);
    timeSignatures.sort((a, b) => a.tick - b.tick);
    return {
      format,
      trackCount,
      ppq,
      ticksPerQuarter: ppq,
      tempos,
      timeSignatures,
      bpm: tempos[0]?.bpm || 120,
      tracks
    };
  }

  function encode(song) {
    const ppq = Math.max(24, Math.min(32767, Math.round(song.ppq || 480)));
    const stepTicks = Math.max(1, Math.round(ppq / 4));
    const bpm = Math.max(1, Number(song.bpm) || 120);
    const out = [];
    const tracks = Array.isArray(song.tracks) && song.tracks.length ? song.tracks : [{ name: 'Track 1', notes: [] }];
    const header = [...u16w(1), ...u16w(tracks.length + 1), ...u16w(ppq)];
    out.push(...chunk('MThd', header));

    const micros = Math.round(60000000 / bpm);
    out.push(...chunk('MTrk', [
      ...writeVLQ(0), 0xFF, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255,
      ...writeVLQ(0), 0xFF, 0x58, 0x04, 4, 2, 24, 8,
      ...writeVLQ(0), 0xFF, 0x2F, 0x00
    ]));

    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index] || {};
      const channel = Number.isFinite(track.channel) ? ((track.channel % 16) + 16) % 16 : (index < 9 ? index : (index + 1) % 16);
      const events = [];
      const name = String(track.name || `Track ${index + 1}`).slice(0, 127);
      const nameBytes = [...name].map(c => c.charCodeAt(0) & 127);
      events.push({ tick: 0, order: 0, bytes: [0xFF, 0x03, ...writeVLQ(nameBytes.length), ...nameBytes] });
      for (const note of track.notes || []) {
        const tick = Math.max(0, Math.round((Number(note.t) || 0) * stepTicks));
        const duration = Math.max(1, Math.round((Number(note.l) || 1) * stepTicks));
        const pitch = Math.max(0, Math.min(127, Math.round(Number(note.p ?? note.pitch) || 0)));
        const velocity = Math.max(1, Math.min(127, Math.round(Number(note.velocity) || 100)));
        events.push({ tick, order: 1, bytes: [0x90 | channel, pitch, velocity] });
        events.push({ tick: tick + duration, order: 0, bytes: [0x80 | channel, pitch, 0] });
      }
      events.sort((a, b) => a.tick - b.tick || a.order - b.order);
      const data = [];
      let lastTick = 0;
      for (const event of events) {
        data.push(...writeVLQ(event.tick - lastTick), ...event.bytes);
        lastTick = event.tick;
      }
      data.push(...writeVLQ(0), 0xFF, 0x2F, 0x00);
      out.push(...chunk('MTrk', data));
    }
    return new Uint8Array(out);
  }

  function bytesToDataURL(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    return `data:audio/midi;base64,${btoa(binary)}`;
  }

  window.UIXMIDIParser = { parse, encode, bytesToDataURL };
})();
