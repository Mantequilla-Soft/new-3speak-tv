import { FaHive } from 'react-icons/fa6';
import { useRewardDisplay } from '../../utils/hivePrice';
import './PayoutAmount.scss';

// `amount` is the post's reward in HBD (dollars). Guests and warm-up accounts
// see it in HIVE instead (see useRewardDisplay).
function PayoutAmount({ amount, size, onClick }) {
  const { inHive, format } = useRewardDisplay();
  const iconSize = size ? Math.round(size * 1.25) : undefined;

  let display;
  if (typeof amount === 'number') display = inHive ? format(amount) : amount.toFixed(2);
  else display = amount ?? '…';

  return (
    <div className={`payout-amount-badge${onClick ? ' clickable' : ''}`} style={size ? { fontSize: size } : undefined} onClick={onClick}>
      <FaHive size={iconSize || undefined} />
      <span>{inHive ? display : `$${display}`}</span>
    </div>
  );
}

export default PayoutAmount;
