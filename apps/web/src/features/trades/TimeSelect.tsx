import { Select } from '../../components/ui/select';

export function TimeSelect({
  value,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [hour = '12', minute = '00'] = value ? value.split(':') : [];

  return (
    <fieldset className="time-select-field" disabled={disabled}>
      <legend>Time</legend>
      <div className="time-select-pair">
        <Select
          className="ui-input"
          aria-label="Hour"
          value={hour}
          disabled={disabled}
          onChange={(event) => onChange(`${event.target.value}:${minute}`)}
        >
          {Array.from({ length: 24 }, (_, number) => {
            const option = String(number).padStart(2, '0');
            return (
              <option key={option} value={option}>
                {option}
              </option>
            );
          })}
        </Select>
        <span aria-hidden="true">:</span>
        <Select
          className="ui-input"
          aria-label="Minute"
          value={minute}
          disabled={disabled}
          onChange={(event) => onChange(`${hour}:${event.target.value}`)}
        >
          {Array.from({ length: 60 }, (_, number) => {
            const option = String(number).padStart(2, '0');
            return (
              <option key={option} value={option}>
                {option}
              </option>
            );
          })}
        </Select>
      </div>
    </fieldset>
  );
}
