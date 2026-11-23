import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Clock, X, ChevronRight, ChevronLeft, Volume2, VolumeX } from 'lucide-react';
import { Appointment } from '../App';
import { getCairoNow, getTodayISO } from '../src/utils/dateFormatter';

export interface BookingAlertItem {
  id: string;
  stage: 't30' | 'due';
  key: string;
  customerName: string;
  time: string;
  rawTime: string;
  barberName: string;
  title: string;
}

interface BookingAlertsNotificationProps {
  appointments: Appointment[];
  branchId: number;
  cashierId?: number;
}

const getStorageKey = (branchId: number, cashierId?: number) => {
  return `mini_booking_acks:${branchId}_${cashierId || 'default'}`;
};

const loadAcks = (storageKey: string): Record<string, number> => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    // Prune acknowledgements older than 48 hours to keep storage minimal
    const pruned: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && now - v < 48 * 3600 * 1000) {
        pruned[k] = v;
      }
    }
    return pruned;
  } catch {
    return {};
  }
};

export const BookingAlertsNotification: React.FC<BookingAlertsNotificationProps> = ({
  appointments,
  branchId,
  cashierId,
}) => {
  const storageKey = useMemo(() => getStorageKey(branchId, cashierId), [branchId, cashierId]);
  const [acks, setAcks] = useState<Record<string, number>>(() => loadAcks(storageKey));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const isMuted = Boolean(acks['pref:sound_muted']);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch {
        // ignore
      }
      currentAudioRef.current = null;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setAcks((prev) => {
      const nextMuted = prev['pref:sound_muted'] ? 0 : 1;
      const next = { ...prev, ['pref:sound_muted']: nextMuted };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save sound preference:', e);
      }
      return next;
    });
    if (!isMuted) {
      stopAudio();
    }
  }, [isMuted, stopAudio, storageKey]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  // Periodic evaluation ticker (every 5 seconds) to catch arrival at T-30m and T-0m
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update acks if storageKey changes (e.g. branch or cashier switch)
  useEffect(() => {
    setAcks(loadAcks(storageKey));
    setCurrentIndex(0);
  }, [storageKey]);

  // Record newly triggered (seen) alerts so that once triggered, they remain visible until explicitly dismissed
  useEffect(() => {
    const cairoNow = getCairoNow();
    const todayISO = getTodayISO();

    const todayAppointments = appointments.filter((a) => {
      const isToday = a.date === 'اليوم' || a.rawDate === todayISO;
      const isActive = a.rawStatus !== 'cancelled' && a.rawStatus !== 'completed';
      return isToday && isActive;
    });

    const newlySeen: Record<string, number> = {};
    const now = Date.now();

    for (const app of todayAppointments) {
      const raw = app.rawTime || app.time;
      if (!raw || !raw.includes(':')) continue;

      const parts = raw.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(m)) continue;

      const appDate = new Date(cairoNow.getTime());
      appDate.setHours(h, m, 0, 0);

      const diffMinutes = (appDate.getTime() - cairoNow.getTime()) / (60 * 1000);

      // Stage A check (T-30)
      const t30Key = `${app.id}_${raw}_t30`;
      const isT30Ack = acks[`ack:${t30Key}`] || acks[t30Key];
      const isT30Seen = acks[`seen:${t30Key}`];
      if (!isT30Ack && !isT30Seen && diffMinutes > 0 && diffMinutes <= 30) {
        newlySeen[`seen:${t30Key}`] = now;
      }

      // Stage B check (Due)
      const dueKey = `${app.id}_${raw}_due`;
      const isDueAck = acks[`ack:${dueKey}`] || acks[dueKey];
      const isDueSeen = acks[`seen:${dueKey}`];
      if (!isDueAck && !isDueSeen && diffMinutes <= 0 && diffMinutes >= -60) {
        newlySeen[`seen:${dueKey}`] = now;
      }
    }

    if (Object.keys(newlySeen).length > 0) {
      // Determine announcement sound:
      // Priority: 'due' announcement ('elgom.mp3') if any due triggered, otherwise 't30' ('30min.mp3')
      // Exactly one announcement per trigger event, avoiding overlapping voices.
      let soundToPlay: 'due' | 't30' | null = null;
      for (const k of Object.keys(newlySeen)) {
        if (k.endsWith('_due')) {
          soundToPlay = 'due';
          break;
        } else if (k.endsWith('_t30') && !soundToPlay) {
          soundToPlay = 't30';
        }
      }

      if (soundToPlay && !isMuted) {
        try {
          stopAudio();
          const basePath = (import.meta.env.BASE_URL || '/mini/').replace(/\/+$/, '');
          const file = soundToPlay === 'due' ? `${basePath}/audio/elgom.mp3` : `${basePath}/audio/30min.mp3`;
          const audio = new Audio(file);
          currentAudioRef.current = audio;
          audio.onended = () => {
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
          };
          const p = audio.play();
          if (p !== undefined) {
            p.catch((err) => {
              // Browser autoplay policy restriction: gracefully ignored without blocking UI
              console.warn('Audio playback blocked by autoplay policy:', err);
            });
          }
        } catch (err) {
          console.warn('Audio playback failed:', err);
        }
      }

      setAcks((prev) => {
        const next = { ...prev, ...newlySeen };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (e) {
          console.error('Failed to save seen alerts:', e);
        }
        return next;
      });
    }
  }, [appointments, acks, isMuted, stopAudio, storageKey, tick]);

  // Compute active unacknowledged reminders
  const activeAlerts: BookingAlertItem[] = useMemo(() => {
    const cairoNow = getCairoNow();
    const todayISO = getTodayISO();

    const todayAppointments = appointments.filter((a) => {
      const isToday = a.date === 'اليوم' || a.rawDate === todayISO;
      const isActive = a.rawStatus !== 'cancelled' && a.rawStatus !== 'completed';
      return isToday && isActive;
    });

    const items: BookingAlertItem[] = [];

    for (const app of todayAppointments) {
      const raw = app.rawTime || app.time;
      if (!raw || !raw.includes(':')) continue;

      const parts = raw.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(m)) continue;

      const appDate = new Date(cairoNow.getTime());
      appDate.setHours(h, m, 0, 0);

      const diffMinutes = (appDate.getTime() - cairoNow.getTime()) / (60 * 1000);

      // Stage A: 30 minutes before appointment
      const t30Key = `${app.id}_${raw}_t30`;
      const isT30Ack = Boolean(acks[`ack:${t30Key}`] || acks[t30Key]);
      const isT30Seen = Boolean(acks[`seen:${t30Key}`]);
      const isT30Eligible = diffMinutes > 0 && diffMinutes <= 30;

      if (!isT30Ack && (isT30Seen || isT30Eligible)) {
        items.push({
          id: app.id,
          stage: 't30',
          key: t30Key,
          customerName: app.customerName,
          time: app.time,
          rawTime: raw,
          barberName: app.barberName && app.barberName !== 'غير محدد' ? app.barberName : '',
          title: 'حجز بعد نص ساعة',
        });
      }

      // Stage B: At appointment time (persists until cashier acknowledges or appointment completes/cancels)
      const dueKey = `${app.id}_${raw}_due`;
      const isDueAck = Boolean(acks[`ack:${dueKey}`] || acks[dueKey]);
      const isDueSeen = Boolean(acks[`seen:${dueKey}`]);
      const isDueEligible = diffMinutes <= 0 && diffMinutes >= -60;

      if (!isDueAck && (isDueSeen || isDueEligible)) {
        items.push({
          id: app.id,
          stage: 'due',
          key: dueKey,
          customerName: app.customerName,
          time: app.time,
          rawTime: raw,
          barberName: app.barberName && app.barberName !== 'غير محدد' ? app.barberName : '',
          title: 'حان موعد الحجز',
        });
      }
    }

    // Sort by priority: 'due' first, then 't30', then by time
    return items.sort((a, b) => {
      if (a.stage === 'due' && b.stage !== 'due') return -1;
      if (b.stage === 'due' && a.stage !== 'due') return 1;
      return a.rawTime.localeCompare(b.rawTime);
    });
  }, [appointments, acks, tick]);

  // Keep currentIndex in bounds
  useEffect(() => {
    if (currentIndex >= activeAlerts.length && activeAlerts.length > 0) {
      setCurrentIndex(activeAlerts.length - 1);
    }
  }, [activeAlerts.length, currentIndex]);

  // Stop audio if all alerts cleared or unmounted
  useEffect(() => {
    if (activeAlerts.length === 0) {
      stopAudio();
    }
  }, [activeAlerts.length, stopAudio]);

  const dismissOne = useCallback(
    (key: string) => {
      stopAudio();
      setAcks((prev) => {
        const next = { ...prev, [`ack:${key}`]: Date.now(), [key]: Date.now() };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (e) {
          console.error('Failed to save booking ack:', e);
        }
        return next;
      });
    },
    [stopAudio, storageKey],
  );

  const dismissAll = useCallback(() => {
    stopAudio();
    setAcks((prev) => {
      const next = { ...prev };
      const now = Date.now();
      for (const item of activeAlerts) {
        next[`ack:${item.key}`] = now;
        next[item.key] = now;
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save booking acks:', e);
      }
      return next;
    });
  }, [activeAlerts, stopAudio, storageKey]);

  if (activeAlerts.length === 0) {
    return null;
  }

  const current = activeAlerts[currentIndex] || activeAlerts[0];
  const isMultiple = activeAlerts.length > 1;

  return (
    <div
      dir="rtl"
      role="alert"
      aria-live="polite"
      className="fixed top-6 left-6 z-[140] w-80 max-w-[calc(100vw-3rem)] pointer-events-auto font-['Cairo'] animate-in fade-in slide-in-from-top-4 duration-300"
    >
      <div className="rounded-2xl bg-[#161616] border border-[#A8906A]/40 shadow-2xl shadow-black/90 p-4 space-y-3 backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#A8906A]/15 border border-[#A8906A]/30 flex items-center justify-center text-[#A8906A] shrink-0">
              <Clock size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-[#A8906A]">{current.title}</span>
                {isMultiple && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/10 text-white/80">
                    {currentIndex + 1} من {activeAlerts.length}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleMute}
              className={`p-1 rounded-full transition-colors ${
                isMuted ? 'text-white/30 hover:text-white' : 'text-[#A8906A] hover:text-[#C4A474]'
              }`}
              title={isMuted ? 'تفعيل الصوت' : 'كتم الصوت'}
            >
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <button
              type="button"
              onClick={() => dismissOne(current.key)}
              className="text-white/40 hover:text-white p-1 rounded-full transition-colors"
              title="إغلاق التنبيه"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-1 py-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-sm font-black text-white truncate">{current.customerName}</h4>
            <span className="text-xs font-mono font-bold text-[#A8906A] shrink-0">{current.time}</span>
          </div>
          {current.barberName && (
            <p className="text-xs text-white/60">
              الحلاق: <span className="text-white/90 font-bold">{current.barberName}</span>
            </p>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => dismissOne(current.key)}
            className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-[#A8906A] to-[#8C7654] text-black font-black text-xs shadow-md shadow-[#A8906A]/20 hover:brightness-110 active:scale-95 transition-all text-center"
          >
            تمام، فهمت
          </button>

          {isMultiple && (
            <>
              <button
                type="button"
                onClick={dismissAll}
                className="py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-bold transition-all"
                title="تأكيد كل التنبيهات الحالية"
              >
                فهمت الكل
              </button>
              <div className="flex items-center gap-0.5 border-r border-white/10 pr-1">
                <button
                  type="button"
                  onClick={() => setCurrentIndex((i) => (i > 0 ? i - 1 : activeAlerts.length - 1))}
                  className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
                  title="السابق"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentIndex((i) => (i < activeAlerts.length - 1 ? i + 1 : 0))}
                  className="p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
                  title="التالي"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingAlertsNotification;
