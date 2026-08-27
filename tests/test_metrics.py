"""agent/core/metrics.py — ölçüm toplayıcısının ilk çağrı davranışı ve wire sözleşmesi."""

from dataclasses import asdict

from agent.core.config import Config
from agent.core.metrics import MetricsCollector

# Eklentisiz varsayılan: yalnızca çekirdek metrikler toplanır.
CONFIG = Config(collector_url="https://collector.test", device_key="tbx_live_test")


def test_first_sample_has_no_network_rate():
    """İlk ölçümde karşılaştırılacak önceki sayaç yoktur.

    Hız hesaplanamadığında 0.0 değil None yazılır: 0.0 "trafik yoktu"
    demek olurdu, oysa burada ölçüm hiç yapılamamıştır.
    """
    sample = MetricsCollector().collect(CONFIG).sample
    assert sample.net_sent_mb is None
    assert sample.net_recv_mb is None


def test_reading_carries_the_ram_percentage_beside_the_sample():
    """Yüzde ölçümün YANINDA taşınır, içinde değil.

    Flush eşiği yüzdeyle konuşur (ram>90), şema ise yalnızca ram_used_mb
    tutar. İkisi aynı psutil okumasından çıkar; ayrılmasalardı eşik ya
    kaydedilenden farklı bir ana bakardı ya da wire sözleşmesi bozulurdu.
    """
    reading = MetricsCollector().collect(CONFIG)

    assert reading.ram_percent is not None
    assert 0.0 <= reading.ram_percent <= 100.0
    assert "ram_percent" not in asdict(reading.sample), "yüzde wire gövdesine sızdı"


def test_sample_fields_are_exactly_what_the_collector_accepts():
    """asdict(sample) doğrudan POST /ingest gövdesine giriyor.

    Collector'ın MetricIn'i extra="forbid" ile tanımlı: sözleşmede olmayan tek
    bir alan tüm batch'i 422 ile geri çevirir. Bu yüzden MetricSample'a alan
    eklemek collector'ı da güncellemeyi ZORUNLU kılar — bunu çalışma anında
    değil burada öğrenmek gerekir.
    """
    from collector.endpoints_ingest import MetricIn

    sample_fields = set(asdict(MetricsCollector().collect(CONFIG).sample))

    assert sample_fields <= set(MetricIn.model_fields), (
        "collector bu alanları tanımıyor: " f"{sorted(sample_fields - set(MetricIn.model_fields))}"
    )
