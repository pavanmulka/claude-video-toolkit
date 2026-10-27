"""Caption chunking: word timestamps from the voice-over become short on-screen chunks."""
from toolkit import captions


def words(text, step=0.3, length=0.25, start=0.0):
    return [{"w": w, "start": start + i * step, "end": start + i * step + length} for i, w in enumerate(text.split())]


def test_chunks_respect_max_words_and_keep_every_word_in_order():
    ws = words("one two three four five six seven eight nine ten")
    chunks = captions.chunk(ws, max_words=4)
    assert all(len(c["words"]) <= 4 for c in chunks)
    assert [w["w"] for c in chunks for w in c["words"]] == [w["w"] for w in ws]


def test_chunks_follow_each_other_in_time():
    chunks = captions.chunk(words("a b c d e f g h"), max_words=3)
    for prev, nxt in zip(chunks, chunks[1:]):
        assert prev["end"] <= nxt["start"] + 1e-9


def test_a_long_pause_starts_a_new_chunk():
    ws = words("before the pause") + words("after it", start=3.0)
    chunks = captions.chunk(ws, max_words=5)
    assert [" ".join(w["w"] for w in c["words"]) for c in chunks] == ["before the pause", "after it"]


def test_active_finds_the_chunk_and_the_spoken_word():
    chunks = captions.chunk(words("one two three four five six"), max_words=3)
    assert captions.active(chunks, 0.1) == (0, 0)                  # first chunk, first word
    assert captions.active(chunks, 0.65) == (0, 2)                 # "three" is being said
    assert captions.active(chunks, chunks[1]["start"] + 0.01)[0] == 1
    assert captions.active(chunks, 99) == (None, None)
