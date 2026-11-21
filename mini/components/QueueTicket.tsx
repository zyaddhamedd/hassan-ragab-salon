
import React from 'react';

interface QueueTicketProps {
  ticketNumber: number;
  date: string;
  time: string;
}

const QueueTicket: React.FC<QueueTicketProps> = ({ ticketNumber, date, time }) => {
  return (
    <div id="printable-ticket" className="print-only bg-white text-black p-4 text-center font-sans" dir="rtl" style={{ width: '80mm', margin: '0 auto' }}>
      <div className="border-2 border-black p-4">
        <h1 className="text-xl font-bold mb-1">نادي الرجال السري</h1>
        <p className="text-[10px] border-b border-black pb-2 mb-4">THE SECRET MEN'S CLUB</p>
        
        <p className="text-sm mb-2">رقم الانتظار</p>
        <div className="text-6xl font-black my-4">
          {ticketNumber.toString().padStart(2, '0')}
        </div>
        
        <div className="border-t border-black pt-2 mt-4 space-y-1">
          <p className="text-[10px] flex justify-between">
            <span>التاريخ:</span>
            <span>{date}</span>
          </p>
          <p className="text-[10px] flex justify-between">
            <span>الوقت:</span>
            <span>{time}</span>
          </p>
        </div>
        
        <div className="mt-6">
          <p className="text-[10px] font-bold italic">نورتنا.. يرجى الانتظار حتى مناداة رقمك</p>
        </div>
      </div>
    </div>
  );
};

export default QueueTicket;
