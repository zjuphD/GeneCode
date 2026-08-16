#!/usr/bin/env python3
"""Generate a minimal, valid Applied Biosystems .ab1 Sanger trace file.

The ABI binary layout (big-endian):

    header (30 bytes):
        0-3   "ABIF" magic
        4-7   version int32 (1)
        8-17  unused
        18-21 number of directory entries (int32)
        22-25 unused
        26-29 offset to directory (int32)

    directory entries (28 bytes each):
        0-3   tag name (4 chars, e.g. "DATA", "PBAS", "PLOC", "PCON")
        4-7   tag number (int32)
        8-15  element type/size (ignored by the parser)
        16-19 number of elements (int32)
        20-23 data offset (int32)

The parser in @teselagen/bio-parsers (src/ab1ToJson.js) needs:
    DATA/10  A-channel trace (int16 samples)
    DATA/11  T-channel trace
    DATA/9   G-channel trace
    DATA/12  C-channel trace
    PLOC/2   basecall peak positions (int16, absolute sample index)
    PBAS/2   basecalls (one char each)
    PCON/2   Phred quality values (one byte each)

Everything else is optional, so this script writes only those seven tags and
synthesizes Gaussian peaks: the called base's dye channel carries a tall peak
at its sample position, the other three channels carry small noise.

Usage:
    python3 scripts/make_minimal_ab1.py [output.ab1]
"""

import math
import random
import struct
import sys

# pUC19 MCS (HindIII->EcoRI) — a real substring of the bundled SYNPUC19V
# reference so the verification flow finds a high-identity match.
DEFAULT_BASECALLS = (
    "AAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTC"
)

# ABI dye channel index per base.
CHANNEL_OF_BASE = {"A": 0, "T": 1, "G": 2, "C": 3}


def build_trace_data(basecalls, points_per_base=24, peak_amplitude=2800,
                     noise=90, seed=7):
    """Return (traces, base_pos, qual_nums).

    traces is a list of four channel lists; each channel has
    len(basecalls) * points_per_base int16 samples. Every basecall gets a
    Gaussian peak of `peak_amplitude` centered at its sample position in its
    own dye channel; other channels get low-amplitude noise so the
    chromatogram renderer has realistic background.
    """
    rng = random.Random(seed)
    n = len(basecalls)
    total = n * points_per_base
    traces = [[0] * total for _ in range(4)]
    base_pos = []
    qual_nums = []

    for i, base in enumerate(basecalls):
        center = i * points_per_base + points_per_base // 2
        base_pos.append(center)
        qual_nums.append(rng.randint(28, 45))
        channel = CHANNEL_OF_BASE.get(base.upper(), rng.randrange(4))
        sigma = points_per_base / 6.0
        for offset in range(-points_per_base, points_per_base):
            idx = center + offset
            if 0 <= idx < total:
                value = peak_amplitude * math.exp(-0.5 * (offset / sigma) ** 2)
                traces[channel][idx] += int(value)
        # Background noise in every channel.
        for ch in range(4):
            for offset in range(-2, 3):
                idx = center + offset
                if 0 <= idx < total:
                    traces[ch][idx] += rng.randint(-noise, noise)

    # Clamp to int16 range.
    traces = [
        [max(-32768, min(32767, int(v))) for v in channel]
        for channel in traces
    ]
    return traces, base_pos, qual_nums


def make_ab1(basecalls, points_per_base=24, seed=7):
    """Serialize basecalls into a complete .ab1 byte string."""
    traces, base_pos, qual_nums = build_trace_data(
        basecalls, points_per_base=points_per_base, seed=seed
    )

    # ---- data payloads ---------------------------------------------------
    channel_bytes = [
        b"".join(struct.pack(">h", v) for v in channel)
        for channel in traces
    ]
    base_pos_bytes = b"".join(struct.pack(">h", v) for v in base_pos)
    basecall_bytes = "".join(basecalls).encode("latin-1")
    qual_bytes = bytes(qual_nums)

    # ---- directory entries ----------------------------------------------
    # Layout order: name(4) tagNum(4) pad(8) count(4) offset(4) — 28 bytes.
    tags = [
        ("DATA", 10, channel_bytes[0]),  # A
        ("DATA", 11, channel_bytes[1]),  # T
        ("DATA", 9, channel_bytes[2]),   # G
        ("DATA", 12, channel_bytes[3]),  # C
        ("PLOC", 2, base_pos_bytes),
        ("PBAS", 2, basecall_bytes),
        ("PCON", 2, qual_bytes),
    ]

    # Header first (30 bytes: 4 magic + 4 version + 10 reserved + 4
    # numEntries + 4 reserved + 4 directoryOffset), then data blocks, then
    # the directory. The directory offset is only known after the data is
    # laid out.
    header_size = 30
    data_offset = header_size
    entries = []
    for name, tag_num, payload in tags:
        # NOTE: bio-parsers' getShort reads int16s stepping by 2, treating
        # the directory count as a *byte* budget (getChar/getNumber read one
        # byte per element), so we use the payload byte length for every
        # tag. This matches this parser's behavior; it is not asserted to be
        # the ABI spec convention.
        entries.append({
            "name": name,
            "tag_num": tag_num,
            "count": len(payload),
            "offset": data_offset,
            "payload": payload,
        })
        data_offset += len(payload)

    directory_offset = data_offset
    directory = b""
    for entry in entries:
        directory += entry["name"].encode("latin-1")
        directory += struct.pack(">i", entry["tag_num"])
        directory += b"\x00" * 8
        directory += struct.pack(">i", entry["count"])
        directory += struct.pack(">i", entry["offset"])
        directory += struct.pack(">i", len(entry["payload"]))  # dataSize

    header = b"ABIF"
    header += struct.pack(">i", 1)  # version
    header += b"\x00" * 10
    header += struct.pack(">i", len(entries))
    header += b"\x00" * 4
    header += struct.pack(">i", directory_offset)

    body = b"".join(entry["payload"] for entry in entries)
    return header + body + directory


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else (
        "src/fixtures/synthetic_trace.ab1"
    )
    data = make_ab1(DEFAULT_BASECALLS)
    with open(out_path, "wb") as fh:
        fh.write(data)
    n = len(DEFAULT_BASECALLS)
    print(f"wrote {out_path}: {len(data)} bytes, {n} basecalls, "
          f"{n * 24} samples/channel")


if __name__ == "__main__":
    main()
