/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { cn } from './lib/utils';
import { Info, Settings2, Activity } from 'lucide-react';

interface CanFrame {
  id: number;
  rtr: boolean;
  isFd: boolean;
  brs: boolean;
  dlc: number;
  data: number[];
}

type BitType = 'SOF' | 'ID' | 'RTR' | 'IDE' | 'r0' | 'FDF' | 'res' | 'BRS' | 'ESI' | 'DLC' | 'DATA' | 'STUFF_CNT' | 'CRC' | 'CRC_DELIM' | 'ACK' | 'ACK_DELIM' | 'EOF' | 'IFS';
type GroupType = 'SOF' | 'Arbitration' | 'Control' | 'Data' | 'CRC' | 'ACK' | 'EOF' | 'IFS';

function dlcToLength(dlc: number, isFd: boolean): number {
  if (!isFd) return Math.min(dlc, 8);
  if (dlc <= 8) return dlc;
  switch (dlc) {
    case 9: return 12;
    case 10: return 16;
    case 11: return 20;
    case 12: return 24;
    case 13: return 32;
    case 14: return 48;
    case 15: return 64;
    default: return 8;
  }
}

interface BitNode {
  value: number;
  type: BitType;
  label: string;
  index?: number;
  byteIdx?: number;
  bitIdx?: number;
  isStuff?: boolean;
  group: GroupType;
}

const typeColors: Record<string, string> = {
  SOF: 'bg-white',
  ID: 'bg-green-300',
  RTR: 'bg-cyan-300',
  IDE: 'bg-white',
  r0: 'bg-white',
  FDF: 'bg-purple-300',
  res: 'bg-white',
  BRS: 'bg-orange-300',
  ESI: 'bg-white',
  DLC: 'bg-yellow-300',
  DATA: 'bg-red-400',
  STUFF_CNT: 'bg-gray-200',
  CRC: 'bg-white',
  CRC_DELIM: 'bg-white',
  ACK: 'bg-white',
  ACK_DELIM: 'bg-white',
  EOF: 'bg-white',
  IFS: 'bg-white',
};

const svgColors: Record<string, string> = {
  ID: '#bbf7d0',
  RTR: '#a5f3fc',
  FDF: '#d8b4fe',
  BRS: '#fdba74',
  DLC: '#fef08a',
  DATA: '#fecaca',
};

function generateCanBitstream(frame: CanFrame): BitNode[] {
  const logicalBits: BitNode[] = [];
  
  logicalBits.push({ value: 0, type: 'SOF', label: 'SOF', group: 'SOF' });
  
  for (let i = 10; i >= 0; i--) {
    logicalBits.push({ value: (frame.id >> i) & 1, type: 'ID', label: `ID${i}`, index: i, group: 'Arbitration' });
  }
  
  if (frame.isFd) {
    logicalBits.push({ value: 0, type: 'RTR', label: 'RRS', group: 'Arbitration' });
    logicalBits.push({ value: 0, type: 'IDE', label: 'IDE', group: 'Control' });
    logicalBits.push({ value: 1, type: 'FDF', label: 'FDF', group: 'Control' });
    logicalBits.push({ value: 0, type: 'res', label: 'res', group: 'Control' });
    logicalBits.push({ value: frame.brs ? 1 : 0, type: 'BRS', label: 'BRS', group: 'Control' });
    logicalBits.push({ value: 0, type: 'ESI', label: 'ESI', group: 'Control' });
  } else {
    logicalBits.push({ value: frame.rtr ? 1 : 0, type: 'RTR', label: 'RTR', group: 'Arbitration' });
    logicalBits.push({ value: 0, type: 'IDE', label: 'IDE', group: 'Control' });
    logicalBits.push({ value: 0, type: 'r0', label: 'r0', group: 'Control' });
  }
  
  for (let i = 3; i >= 0; i--) {
    logicalBits.push({ value: (frame.dlc >> i) & 1, type: 'DLC', label: `DLC${i}`, index: i, group: 'Control' });
  }
  
  const dataLen = dlcToLength(frame.dlc, frame.isFd);
  if (!frame.rtr || frame.isFd) {
    for (let i = 0; i < dataLen; i++) {
      const byte = frame.data[i] || 0;
      for (let j = 7; j >= 0; j--) {
        logicalBits.push({ value: (byte >> j) & 1, type: 'DATA', label: `DATA${i*8+j}`, byteIdx: i, bitIdx: j, group: 'Data' });
      }
    }
  }
  
  let crc = 0;
  for (const node of logicalBits) {
    const bit = node.value;
    const crc_msb = (crc >> 14) & 1;
    crc = (crc << 1) & 0x7FFF;
    if (crc_msb ^ bit) {
      crc ^= 0x4599;
    }
  }
  
  if (frame.isFd) {
    for (let i = 4; i >= 0; i--) {
      logicalBits.push({ value: 0, type: 'STUFF_CNT', label: `SC${i}`, group: 'CRC' });
    }
  }
  
  const crcLen = frame.isFd ? (dataLen <= 16 ? 17 : 21) : 15;
  for (let i = crcLen - 1; i >= 0; i--) {
    logicalBits.push({ value: (crc >> i) & 1, type: 'CRC', label: `CRC${i}`, index: i, group: 'CRC' });
  }
  
  const stuffedBits: BitNode[] = [];
  let consecutiveCount = 0;
  let lastBit = -1;
  
  for (const node of logicalBits) {
    if (node.value === lastBit) {
      consecutiveCount++;
      if (consecutiveCount === 5) {
        const stuffValue = lastBit === 1 ? 0 : 1;
        stuffedBits.push({ value: stuffValue, type: node.type, label: 'stuff bit', isStuff: true, group: node.group });
        lastBit = stuffValue;
        consecutiveCount = 1;
      }
    } else {
      consecutiveCount = 1;
      lastBit = node.value;
    }
    stuffedBits.push(node);
  }
  
  stuffedBits.push({ value: 1, type: 'CRC_DELIM', label: 'CRC Delimiter', group: 'CRC' });
  stuffedBits.push({ value: 0, type: 'ACK', label: 'ACK', group: 'ACK' });
  stuffedBits.push({ value: 1, type: 'ACK_DELIM', label: 'ACK Delimiter', group: 'ACK' });
  
  for (let i = 6; i >= 0; i--) {
    stuffedBits.push({ value: 1, type: 'EOF', label: `EOF${i}`, index: i, group: 'EOF' });
  }
  for (let i = 2; i >= 0; i--) {
    stuffedBits.push({ value: 1, type: 'IFS', label: `IFS${i}`, index: i, group: 'IFS' });
  }
  
  return stuffedBits;
}

export default function App() {
  const [frame, setFrame] = useState<CanFrame>({
    id: 0x014,
    rtr: false,
    isFd: false,
    brs: false,
    dlc: 1,
    data: Array(64).fill(0).map((_, i) => i === 0 ? 0x04 : 0)
  });

  const bitWidth = 24;
  const stuffedBits = useMemo(() => generateCanBitstream(frame), [frame]);

  const groups = useMemo(() => {
    const res = [];
    let currentGroup = stuffedBits[0].group;
    let currentCount = 0;
    for (const bit of stuffedBits) {
      if (bit.group === currentGroup) {
        currentCount++;
      } else {
        res.push({ name: currentGroup, count: currentCount });
        currentGroup = bit.group;
        currentCount = 1;
      }
    }
    res.push({ name: currentGroup, count: currentCount });
    return res;
  }, [stuffedBits]);

  const { rxPath, canHPath, canLPath } = useMemo(() => {
    let rxPath = '';
    let canHPath = '';
    let canLPath = '';
    
    const rxHigh = 30, rxLow = 70;
    const recY = 140, domHY = 110, domLY = 170;
    
    let currentRx = stuffedBits[0].value === 1 ? rxHigh : rxLow;
    let currentH = stuffedBits[0].value === 1 ? recY : domHY;
    let currentL = stuffedBits[0].value === 1 ? recY : domLY;
    
    rxPath += `M 0 ${currentRx} `;
    canHPath += `M 0 ${currentH} `;
    canLPath += `M 0 ${currentL} `;
    
    for (let i = 0; i < stuffedBits.length; i++) {
      const bit = stuffedBits[i].value;
      const nextRx = bit === 1 ? rxHigh : rxLow;
      const nextH = bit === 1 ? recY : domHY;
      const nextL = bit === 1 ? recY : domLY;
      
      const xStart = i * bitWidth;
      const xEnd = (i + 1) * bitWidth;
      
      if (currentRx !== nextRx) {
        if (bit === 1) { // Transition to Recessive
          rxPath += `L ${xStart + 2} ${nextRx} `;
          canHPath += `L ${xStart + 1} ${nextH - 10} Q ${xStart + 6} ${nextH} ${xStart + 12} ${nextH} `;
          canLPath += `L ${xStart + 1} ${nextL + 10} Q ${xStart + 6} ${nextL} ${xStart + 12} ${nextL} `;
        } else { // Transition to Dominant
          rxPath += `L ${xStart + 2} ${nextRx} `;
          canHPath += `L ${xStart + 2} ${nextH} `;
          canLPath += `L ${xStart + 2} ${nextL} `;
        }
      }
      
      rxPath += `L ${xEnd} ${nextRx} `;
      canHPath += `L ${xEnd} ${nextH} `;
      canLPath += `L ${xEnd} ${nextL} `;
      
      currentRx = nextRx;
      currentH = nextH;
      currentL = nextL;
    }
    
    return { rxPath, canHPath, canLPath };
  }, [stuffedBits]);

  const handleBitClick = (node: BitNode) => {
    if (node.isStuff) return;
    
    const newFrame = { ...frame };
    
    if (node.type === 'ID') {
      const bitPos = node.index!;
      newFrame.id ^= (1 << bitPos);
    } else if (node.type === 'RTR') {
      if (!newFrame.isFd) newFrame.rtr = !newFrame.rtr;
    } else if (node.type === 'FDF') {
      newFrame.isFd = !newFrame.isFd;
      if (!newFrame.isFd && newFrame.dlc > 8) newFrame.dlc = 8;
    } else if (node.type === 'BRS') {
      newFrame.brs = !newFrame.brs;
    } else if (node.type === 'DLC') {
      const bitPos = node.index!;
      newFrame.dlc ^= (1 << bitPos);
      if (!newFrame.isFd && newFrame.dlc > 8) newFrame.dlc = 8;
    } else if (node.type === 'DATA') {
      const newData = [...newFrame.data];
      newData[node.byteIdx!] ^= (1 << node.bitIdx!);
      newFrame.data = newData;
    }
    
    setFrame(newFrame);
  };

  const handleDataByteKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key.toUpperCase();
    const isHex = /^[0-9A-F]$/.test(key);
    
    if (isHex && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const num = parseInt(key, 16);
      const newData = [...frame.data];
      
      const target = e.target as HTMLInputElement;
      if (target.selectionStart === 0 && target.selectionEnd === target.value.length) {
        newData[index] = num;
      } else {
        newData[index] = ((newData[index] << 4) & 0xF0) | num;
      }
      setFrame({...frame, data: newData});
    } else if (key === 'BACKSPACE') {
      e.preventDefault();
      const newData = [...frame.data];
      newData[index] = (newData[index] >> 4) & 0x0F;
      setFrame({...frame, data: newData});
    } else if (key === 'DELETE') {
      e.preventDefault();
      const newData = [...frame.data];
      newData[index] = 0;
      setFrame({...frame, data: newData});
    } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
    }
  };

  const handleDataByteChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (val) {
      const newData = [...frame.data];
      newData[index] = parseInt(val.slice(-2), 16) || 0;
      setFrame({...frame, data: newData});
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="text-blue-600" size={32} />
            CAN Frame Visualizer
          </h1>
          <p className="text-gray-600 mt-2">
            Interactive visualization of a Standard CAN (Controller Area Network) frame. 
            Edit properties or click directly on the bits to toggle them.
          </p>
        </header>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Settings2 size={20} className="text-gray-500" />
            Frame Properties
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ID (Hex, 11-bit)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-mono">0x</span>
                <input 
                  type="text" 
                  value={frame.id.toString(16).toUpperCase()} 
                  onChange={e => {
                    const val = parseInt(e.target.value, 16);
                    if (!isNaN(val)) setFrame({...frame, id: val & 0x7FF});
                    else if (e.target.value === '') setFrame({...frame, id: 0});
                  }}
                  className="w-full border border-gray-300 rounded-md pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  maxLength={3}
                />
              </div>
            </div>
            
            <div className="flex flex-col justify-center mt-6 gap-2">
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="isFd"
                  checked={frame.isFd} 
                  onChange={e => {
                    const isFd = e.target.checked;
                    let dlc = frame.dlc;
                    if (!isFd && dlc > 8) dlc = 8;
                    setFrame({...frame, isFd, dlc, rtr: isFd ? false : frame.rtr});
                  }}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                />
                <label htmlFor="isFd" className="ml-2 block text-sm font-medium text-gray-700 cursor-pointer select-none">
                  CAN FD
                </label>
              </div>
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="rtr"
                  checked={frame.rtr} 
                  disabled={frame.isFd}
                  onChange={e => setFrame({...frame, rtr: e.target.checked})}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer disabled:opacity-50"
                />
                <label htmlFor="rtr" className="ml-2 block text-sm font-medium text-gray-700 cursor-pointer select-none data-[disabled=true]:opacity-50" data-disabled={frame.isFd}>
                  RTR
                </label>
              </div>
              {frame.isFd && (
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    id="brs"
                    checked={frame.brs} 
                    onChange={e => setFrame({...frame, brs: e.target.checked})}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                  />
                  <label htmlFor="brs" className="ml-2 block text-sm font-medium text-gray-700 cursor-pointer select-none">
                    BRS (Bit Rate Switch)
                  </label>
                </div>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">DLC (0-15)</label>
              <input 
                type="number" 
                min="0" max="15"
                value={frame.dlc} 
                onChange={e => {
                  let val = parseInt(e.target.value);
                  if (isNaN(val)) val = 0;
                  if (val > 15) val = 15;
                  if (val < 0) val = 0;
                  if (!frame.isFd && val > 8) val = 8;
                  
                  setFrame({...frame, dlc: val});
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="text-xs text-gray-500 mt-1">
                Length: {dlcToLength(frame.dlc, frame.isFd)} bytes
              </div>
            </div>
          </div>
          
          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Data Bytes (Hex)</label>
            <div className="flex gap-3 flex-wrap max-h-48 overflow-y-auto custom-scrollbar p-1">
              {Array.from({ length: frame.isFd ? 64 : 8 }).map((_, i) => {
                const isActive = i < dlcToLength(frame.dlc, frame.isFd) && (!frame.rtr || frame.isFd);
                const byte = frame.data[i] || 0;
                return (
                  <div key={i} className={cn("flex flex-col items-center transition-opacity", isActive ? "opacity-100" : "opacity-30")}>
                    <span className="text-xs text-gray-500 mb-1 font-medium">B{i}</span>
                    <input 
                      type="text" 
                      value={byte.toString(16).toUpperCase().padStart(2, '0')} 
                      onChange={e => handleDataByteChange(i, e)}
                      onKeyDown={e => handleDataByteKeyDown(i, e)}
                      disabled={!isActive}
                      className="w-12 text-center border border-gray-300 rounded-md px-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm disabled:bg-gray-100"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-2 mb-6 text-sm text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-100">
            <Info size={16} className="text-blue-500 flex-shrink-0" />
            <p>
              The bitstream below shows the physical bits transmitted on the bus, including <strong className="font-semibold">stuff bits</strong> (inserted after 5 consecutive identical bits). 
              Click on the colored boxes to toggle logical bits.
            </p>
          </div>

          <div className="overflow-x-auto pb-4 custom-scrollbar">
            <div className="inline-block min-w-max pr-8">
              
              {/* Top arrow: Complete CAN frame */}
              <div className="relative flex items-center justify-center mb-4" style={{ width: (stuffedBits.length - 3) * bitWidth }}>
                <div className="absolute left-0 right-0 h-px bg-gray-400 top-1/2"></div>
                <div className="absolute left-0 w-2 h-2 border-t border-l border-gray-400 transform -rotate-45 top-1/2 -mt-1"></div>
                <div className="absolute right-0 w-2 h-2 border-t border-r border-gray-400 transform rotate-45 top-1/2 -mt-1"></div>
                <span className="bg-white px-3 text-sm font-medium text-gray-700 relative z-10">Complete CAN frame</span>
              </div>

              {/* Group arrows */}
              <div className="flex mb-2">
                {groups.map((g, i) => (
                  <div key={i} style={{ width: g.count * bitWidth }} className="relative flex items-center justify-center">
                    <div className="absolute left-0 right-0 h-px bg-gray-300 top-1/2"></div>
                    <div className="absolute left-0 w-1.5 h-1.5 border-t border-l border-gray-400 transform -rotate-45 top-1/2 -mt-[3px]"></div>
                    <div className="absolute right-0 w-1.5 h-1.5 border-t border-r border-gray-400 transform rotate-45 top-1/2 -mt-[3px]"></div>
                    <span className="bg-white px-1 text-xs text-gray-500 relative z-10 whitespace-nowrap">{g.name}</span>
                  </div>
                ))}
              </div>

              {/* Bit labels */}
              <div className="flex items-end h-28 mb-1">
                {stuffedBits.map((bit, i) => (
                  <div key={i} style={{ width: bitWidth }} className="flex flex-col items-center justify-end h-full">
                    <span 
                      className={cn(
                        "text-[11px] whitespace-nowrap font-mono",
                        bit.isStuff ? "text-gray-400 italic" : "text-gray-700"
                      )}
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      {bit.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Bit boxes */}
              <div className="flex border-y border-gray-800 shadow-sm">
                {stuffedBits.map((bit, i) => {
                  const isEditable = bit.type === 'ID' || bit.type === 'RTR' || bit.type === 'FDF' || bit.type === 'BRS' || bit.type === 'DLC' || bit.type === 'DATA';
                  return (
                    <div 
                      key={i} 
                      style={{ width: bitWidth }} 
                      className={cn(
                        "h-8 border-r border-gray-800 flex items-center justify-center font-mono text-sm transition-colors",
                        typeColors[bit.type],
                        bit.isStuff && "opacity-60 italic",
                        isEditable && !bit.isStuff ? "cursor-pointer hover:brightness-90 hover:shadow-inner" : "cursor-default",
                        i === 0 && "border-l"
                      )}
                      onClick={() => isEditable && !bit.isStuff && handleBitClick(bit)}
                      title={isEditable && !bit.isStuff ? 'Click to toggle bit' : bit.isStuff ? 'Stuff bit (auto-inserted)' : 'Auto-computed bit'}
                    >
                      {bit.value}
                    </div>
                  );
                })}
              </div>

              {/* Waveforms */}
              <svg width={stuffedBits.length * bitWidth + 80} height={220} className="block mt-4 overflow-visible">
                <g transform="translate(70, 0)">
                  {/* Background colors */}
                  {stuffedBits.map((bit, i) => {
                    if (bit.type === 'SOF' || bit.type === 'IDE' || bit.type === 'r0' || bit.type === 'CRC' || bit.type === 'CRC_DELIM' || bit.type === 'ACK' || bit.type === 'ACK_DELIM' || bit.type === 'EOF' || bit.type === 'IFS') return null;
                    return svgColors[bit.type] ? (
                      <rect key={i} x={i * bitWidth} y={0} width={bitWidth} height={220} fill={svgColors[bit.type]} opacity={0.3} />
                    ) : null;
                  })}

                  {/* Vertical Grid lines */}
                  {stuffedBits.map((_, i) => (
                    <line key={i} x1={i * bitWidth} y1={0} x2={i * bitWidth} y2={220} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 2" />
                  ))}
                  <line x1={stuffedBits.length * bitWidth} y1={0} x2={stuffedBits.length * bitWidth} y2={220} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 2" />
                  
                  {/* Waveform Paths */}
                  <path d={rxPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
                  <path d={canHPath} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" />
                  <path d={canLPath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
                </g>
                
                {/* Horizontal grid lines for voltage levels */}
                <line x1={70} y1={30} x2={stuffedBits.length * bitWidth + 70} y2={30} stroke="#f3f4f6" strokeWidth="1" />
                <line x1={70} y1={70} x2={stuffedBits.length * bitWidth + 70} y2={70} stroke="#f3f4f6" strokeWidth="1" />
                <line x1={70} y1={110} x2={stuffedBits.length * bitWidth + 70} y2={110} stroke="#f3f4f6" strokeWidth="1" />
                <line x1={70} y1={140} x2={stuffedBits.length * bitWidth + 70} y2={140} stroke="#f3f4f6" strokeWidth="1" strokeDasharray="4 4" />
                <line x1={70} y1={170} x2={stuffedBits.length * bitWidth + 70} y2={170} stroke="#f3f4f6" strokeWidth="1" />

                {/* Labels for waveforms */}
                <text x={0} y={55} className="text-sm font-bold font-mono" fill="#374151">CAN RX</text>
                <text x={0} y={145} className="text-sm font-bold font-mono" fill="#374151">CAN H</text>
                <text x={0} y={175} className="text-sm font-bold font-mono" fill="#374151">CAN L</text>
              </svg>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

