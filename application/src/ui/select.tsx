// A picker the design owns, rather than the one the operating system draws.
//
// WHY NOT `<select>`. A native select cannot be styled past its box: the open list keeps the
// platform's font, its colours, and its own idea of dark mode, so on this page it arrived as
// a white Latin-metric menu in the middle of a dark Persian panel. It also cannot hold a
// mixed-direction option - "$25" beside Persian text - without the browser reordering it.
//
// This is the ARIA select-only combobox: the trigger keeps focus the whole time and points at
// the highlighted option with `aria-activedescendant`, so a screen reader announces the list
// and the moving selection without focus ever leaving the control. That is the part that gets
// dropped when people rebuild a select, and it is the part that makes it usable without eyes.
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface SelectOption {
    value: string;
    label: string;

    /** Render the label as an isolated Latin run - a price, a code, an amount. */
    latin?: boolean;
}

export interface SelectProps {
    id: string;
    value: string;
    options: SelectOption[];
    onChange: (value: string) => void;

    /** The accessible name. This control carries its own, so it needs no visible label. */
    label: string;

    className?: string;
}

export default function Select(props: SelectProps): ReactNode {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);

    const root = useRef<HTMLDivElement | null>(null);
    const trigger = useRef<HTMLButtonElement | null>(null);

    const chosen = props.options.find((option) => option.value === props.value);
    const listId = `${props.id}-listbox`;

    /**
     * Closes on any press outside. Registered only WHILE OPEN - a document listener that
     * outlives its menu is how a page ends up with forty of them after forty renders.
     */
    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointer = (event: Event): void => {
            if (root.current !== null && !root.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', onPointer);
        return () => document.removeEventListener('pointerdown', onPointer);
    }, [open]);

    const show = (): void => {
        // Opening onto the current choice, not onto the top: the list should start where the
        // operator left it, so one arrow press moves to the neighbouring option.
        setActive(
            Math.max(
                0,
                props.options.findIndex((option) => option.value === props.value)
            )
        );
        setOpen(true);
    };

    const choose = (index: number): void => {
        const option = props.options[index];
        if (option !== undefined) {
            props.onChange(option.value);
        }
        setOpen(false);
        trigger.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
        const last = props.options.length - 1;

        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
                event.preventDefault();
                show();
            }
            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                setActive((current) => Math.min(current + 1, last));
                break;
            case 'ArrowUp':
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
                break;
            case 'Home':
                event.preventDefault();
                setActive(0);
                break;
            case 'End':
                event.preventDefault();
                setActive(last);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                choose(active);
                break;
            case 'Escape':
            case 'Tab':
                // Escape abandons the change; Tab closes but lets focus move on.
                setOpen(false);
                break;
            default:
                break;
        }
    };

    return (
        <div className={`relative ${props.className ?? ''}`} ref={root}>
            <button
                id={props.id}
                type="button"
                role="combobox"
                className="flex min-h-tap w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 text-caption font-bold outline-none focus:border-firouze sm:px-4"
                aria-label={props.label}
                aria-haspopup="listbox"
                aria-expanded={open ? 'true' : 'false'}
                aria-controls={listId}
                aria-activedescendant={open ? `${props.id}-option-${active}` : undefined}
                ref={trigger}
                onClick={() => (open ? setOpen(false) : show())}
                onKeyDown={onKeyDown}
            >
                <span className="min-w-0 truncate">
                    {chosen?.latin === true ? (
                        <span dir="ltr" className="latin inline-block">
                            {chosen.label}
                        </span>
                    ) : (
                        <span>{chosen?.label ?? ''}</span>
                    )}
                </span>
                <ChevronDown
                    className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                />
            </button>

            {open && (
                <ul
                    id={listId}
                    role="listbox"
                    className="anim-settle absolute start-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-lg"
                    aria-label={props.label}
                >
                    {props.options.map((option, index) => (
                        <li
                            key={option.value}
                            id={`${props.id}-option-${index}`}
                            role="option"
                            className={`flex min-h-tap cursor-pointer items-center px-3 text-caption font-bold sm:px-4 ${
                                option.value === props.value ? 'text-firouze' : ''
                            } ${index === active ? 'bg-firouze/10' : ''}`}
                            aria-selected={option.value === props.value ? 'true' : 'false'}
                            onPointerEnter={() => setActive(index)}
                            onClick={() => choose(index)}
                        >
                            {option.latin === true ? (
                                <span dir="ltr" className="latin inline-block">
                                    {option.label}
                                </span>
                            ) : (
                                <span>{option.label}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
