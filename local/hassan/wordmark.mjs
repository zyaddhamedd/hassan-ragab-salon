import React from 'react';
import logoUrl from 'virtual:hassan-logo';

// Hassan Ragab Salon official brand identity (Premium Black & Gold)
export default function HassanWordmark({compact = false, className = ''} = {}) {
  return React.createElement('img', {
    src: logoUrl,
    alt: 'Hassan Ragab Salon',
    className: 'hr-brand-logo object-contain ' + (className || ''),
    style: {
      maxWidth: '100%',
      maxHeight: compact ? '36px' : '100%',
      aspectRatio: '849 / 410',
      objectFit: 'contain',
      display: 'inline-block'
    }
  });
}
