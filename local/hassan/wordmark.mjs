import React from 'react';

// Hassan Ragab Salon text-based brand identity (Premium Black & Gold)
export default function HassanWordmark({compact = false} = {}) {
  return React.createElement('span', {
    className: 'hr-wordmark', role: 'img', 'aria-label': 'HASSAN RAGAB SALON', dir: 'ltr',
    style: {
      display: compact ? 'inline-flex' : 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: compact ? 'max-content' : '100%',
      height: compact ? 'auto' : '100%',
      maxWidth: '100%',
      containerType: compact ? undefined : 'inline-size',
      fontFamily: 'Arial Black, Arial, system-ui, sans-serif',
      fontWeight: 900,
      textAlign: 'center',
      color: compact ? 'inherit' : 'var(--hr-brand-color, #D4AF37)',
      fontSize: compact ? 'max(12px, 1em)' : undefined,
      lineHeight: 1.05,
      whiteSpace: 'nowrap'
    },
  },
    React.createElement('span', {style: {fontSize: compact ? '1em' : '14cqw', letterSpacing: '-0.02em', color: '#D4AF37'}}, 'HASSAN RAGAB'),
    React.createElement('span', {style: {fontSize: compact ? '0.75em' : '8.5cqw', letterSpacing: '0.3em', paddingLeft: '0.3em', marginTop: '0.2em', color: '#E5C158'}}, 'SALON')
  );
}
