import { useRewardDisplay } from '../../utils/hivePrice';
import './PayoutAmount.scss';

// The Hive mark, shown before a reward in HIVE so a bare number reads as HIVE
// (a brand mark, not an icon set: Material Symbols has no Hive glyph).
const HiveMark = ({ size }) => (
  <svg className="payout-amount-mark" width={size} height={size} viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M260.353,254.878,131.538,33.1a2.208,2.208,0,0,0-3.829.009L.3,254.887A2.234,2.234,0,0,0,.3,257.122L129.116,478.9a2.208,2.208,0,0,0,3.83-.009L260.358,257.113A2.239,2.239,0,0,0,260.353,254.878Zm39.078-25.713a2.19,2.19,0,0,0,1.9,1.111h66.509a2.226,2.226,0,0,0,1.9-3.341L259.115,33.111a2.187,2.187,0,0,0-1.9-1.111H190.707a2.226,2.226,0,0,0-1.9,3.341ZM511.7,254.886,384.9,33.112A2.2,2.2,0,0,0,382.99,32h-66.6a2.226,2.226,0,0,0-1.906,3.34L440.652,256,314.481,476.66a2.226,2.226,0,0,0,1.906,3.34h66.6a2.2,2.2,0,0,0,1.906-1.112L511.7,257.114A2.243,2.243,0,0,0,511.7,254.886ZM366.016,284.917H299.508a2.187,2.187,0,0,0-1.9,1.111l-108.8,190.631a2.226,2.226,0,0,0,1.9,3.341h66.509a2.187,2.187,0,0,0,1.9-1.111l108.8-190.631A2.226,2.226,0,0,0,366.016,284.917Z" />
  </svg>
);

// `amount` is the post's reward in HBD (dollars). Guests and warm-up accounts
// see it in HIVE instead (see useRewardDisplay). Money is accent + Roboto Mono.
function PayoutAmount({ amount, size, onClick }) {
  const { inHive, format } = useRewardDisplay();

  let display;
  if (typeof amount === 'number') display = inHive ? format(amount) : amount.toFixed(2);
  else display = amount ?? '…';

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`payout-amount-badge${onClick ? ' clickable' : ''}`}
      style={size ? { fontSize: size } : undefined}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {inHive && <HiveMark size={size ? Math.round(size * 0.9) : 11} />}
      <span>{inHive ? display : `$${display}`}</span>
    </Tag>
  );
}

export default PayoutAmount;
