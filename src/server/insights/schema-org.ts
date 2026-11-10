import { safeHttpUrl } from "@/lib/insights";
import type { Insight, OrderStatus } from "@/lib/types";

/**
 * Structured data some senders put in their emails for Gmail (schema.org JSON-LD: orders, parcels,
 * flights, trains, hotels, events, invoices). When it's there, it's exact and free: no AI needed.
 */

export type Extracted = Omit<Insight, "key" | "at"> & { ref: string | null };

type Node = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Node | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : null);
const name = (v: unknown) => str(obj(v)?.name) ?? str(v);
const typeOf = (n: Node) => String(n["@type"] ?? "").replace(/^https?:\/\/schema\.org\//, "");

/** "2026-11-14T07:05:00+01:00" → "2026-11-14T07:05" (the time as the sender states it). */
const local = (v: unknown) => {
  const s = str(v);
  const m = s ? /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(s) : null;
  return m ? (m[2] ? `${m[1]}T${m[2]}` : m[1]) : null;
};

const ORDER_STATUS: Record<string, OrderStatus> = {
  OrderProcessing: "placed",
  OrderPaymentDue: "placed",
  OrderPickupAvailable: "ready_for_pickup",
  OrderInTransit: "shipped",
  OrderDelivered: "delivered",
  OrderCancelled: "cancelled",
  OrderReturned: "returned",
  OrderProblem: "placed",
};
const orderStatus = (v: unknown) => ORDER_STATUS[(str(v) ?? "").replace(/^https?:\/\/schema\.org\//, "")] ?? null;

/** The first item of an order ("Bosch Serie 6", "+ 2" when there are more). */
function itemName(order: Node): string | null {
  const offers = Array.isArray(order.acceptedOffer) ? order.acceptedOffer : order.acceptedOffer ? [order.acceptedOffer] : [];
  const first = name(obj(obj(offers[0])?.itemOffered)) ?? name(obj(order.orderedItem));
  if (!first) return null;
  return offers.length > 1 ? `${first} + ${offers.length - 1}` : first;
}

function price(n: Node | null) {
  if (!n) return { amount: null, currency: null };
  const total = obj(n.totalPaymentDue) ?? obj(n.price) ?? n;
  return { amount: num(total.price ?? total.value ?? n.price), currency: str(total.priceCurrency ?? n.priceCurrency) };
}

function fromNode(n: Node): Extracted | null {
  const type = typeOf(n);
  if (type === "Order") {
    return {
      category: "order",
      merchant: name(n.merchant) ?? name(n.seller),
      ...price(n),
      ref: str(n.orderNumber),
      order: {
        number: str(n.orderNumber),
        item: itemName(n),
        role: "buyer",
        status: orderStatus(n.orderStatus),
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
        expectedAt: null,
        pickupBy: null,
        returnBy: null,
      },
    };
  }
  if (type === "ParcelDelivery") {
    const order = obj(n.partOfOrder);
    return {
      category: "order",
      merchant: name(order?.merchant) ?? name(n.provider),
      ...price(order),
      ref: str(order?.orderNumber),
      order: {
        number: str(order?.orderNumber),
        item: order ? itemName(order) : null,
        role: "buyer",
        status: orderStatus(order?.orderStatus) ?? "shipped",
        carrier: name(n.carrier) ?? name(n.provider),
        trackingNumber: str(n.trackingNumber),
        trackingUrl: safeHttpUrl(str(n.trackingUrl)),
        expectedAt: local(n.expectedArrivalUntil ?? n.expectedArrivalFrom),
        pickupBy: null,
        returnBy: null,
      },
    };
  }
  if (type.endsWith("Reservation")) {
    const target = obj(n.reservationFor) ?? {};
    const kind =
      type === "FlightReservation"
        ? "flight"
        : type === "TrainReservation"
          ? "train"
          : type === "BusReservation"
            ? "bus"
            : type === "LodgingReservation"
              ? "hotel"
              : type === "RentalCarReservation"
                ? "rental"
                : type === "EventReservation"
                  ? "event"
                  : "other";
    const place = (v: unknown) => str(obj(v)?.iataCode) ?? name(v);
    const lodging = kind === "hotel" || kind === "event";
    return {
      category: "travel",
      merchant: name(target.airline) ?? name(target.provider) ?? name(n.provider) ?? (lodging ? name(target) : null),
      ...price(n),
      ref: str(n.reservationNumber),
      travel: {
        kind,
        from: lodging ? null : (place(target.departureAirport) ?? place(target.departureStation) ?? place(target.departureBusStop)),
        to: lodging ? (name(target) ?? name(obj(target.location))) : (place(target.arrivalAirport) ?? place(target.arrivalStation) ?? place(target.arrivalBusStop)),
        startsAt: local(n.checkinTime ?? target.departureTime ?? target.startDate ?? n.pickupTime),
        endsAt: local(n.checkoutTime ?? target.arrivalTime ?? target.endDate ?? n.dropoffTime),
        bookingCode: str(n.reservationNumber),
      },
    };
  }
  if (type === "Invoice") {
    const status = (str(n.paymentStatus) ?? "").replace(/^https?:\/\/schema\.org\//, "");
    return {
      category: "invoice",
      merchant: name(n.provider) ?? name(n.broker),
      ...price(n),
      ref: str(n.confirmationNumber) ?? str(n.identifier),
      invoice: {
        number: str(n.confirmationNumber) ?? str(n.identifier),
        toPay: status === "PaymentDue" || status === "PaymentPastDue" ? true : status ? false : null,
        dueAt: local(n.paymentDueDate),
        status:
          status === "PaymentComplete" || status === "PaymentAutomaticallyApplied"
            ? "paid"
            : status === "PaymentPastDue"
              ? "overdue"
              : status
                ? "due"
                : null,
        variableSymbol: null,
      },
    };
  }
  return null;
}

function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) for (const v of value) yield* nodes(v);
  else if (obj(value)) {
    const n = value as Node;
    if (Array.isArray(n["@graph"])) yield* nodes(n["@graph"]);
    else yield n;
  }
}

export function fromSchemaOrg(html: string | null): Extracted | null {
  if (!html || !html.includes("ld+json")) return null;
  for (const m of html.matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const n of nodes(data)) {
      const found = fromNode(n);
      if (found) return found;
    }
  }
  return null;
}
