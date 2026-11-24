# TraceBox

[English](#english) · [Türkçe](#türkçe)

---

## English

**Remote recording and monitoring for Linux machines** — for machines that may not survive long enough to tell you what happened to them.

A small agent runs on the monitored machine and continuously sends its metrics and system logs somewhere else. When the machine crashes, the moments leading up to the crash are already stored elsewhere and readable from a browser. Like an aircraft's black box: it records up to the last moment, and it sits where the crash cannot reach it.

### How it started

My laptop, a Monster Abra A5 V20, started to "die" every time I closed the lid. In the morning I would open it to a pitch-black screen. I pressed keys, nothing happened. The only way out was holding the power button.

I took the computer to a repair shop. The diagnosis came quickly: *"The motherboard is gone, it needs replacing. It'll hold for a while."* Something felt wrong to me. As long as I did not close the lid, the machine ran all day without a problem. What could a dying motherboard have to do with a lid?

Before paying, I tried one thing. I closed the lid, opened it, looked at the black screen, and tried to connect to the laptop over SSH from my phone.

**It answered.**

The machine had not died. It had not even frozen. The processor was idle, the temperature was normal, all services were running. It had woken up from sleep perfectly, it just had no screen. The logs told the rest: at the exact moment of waking up, the NVIDIA driver had failed to restore the graphics card's memory. The driver was set up to preserve video memory during sleep, but the three small systemd services that actually do the saving and restoring had never been enabled.

The fix was a single line:

    sudo systemctl enable nvidia-suspend nvidia-resume nvidia-hibernate

There was no motherboard problem.

#### The real lesson

Finding the problem took days, fixing it took ten seconds. The only thing that made the difference was **being able to see what was happening inside the machine.** I was lucky: the machine was up and I could get into it. But on a machine that has really crashed, those logs either stay locked on the disk or disappear with the power button. All you are left with is the repairer's word.

I built TraceBox for this. Before a machine becomes unable to explain itself, it should carry out what is happening, so that when someone says "the motherboard is gone", you hold real data.

### What is in the system

- **Agent.** A small program on the monitored machine. It measures CPU, RAM, disk, temperature, swap, load and graphics card, and reads the system logs. Everything is written to the local disk first and sent afterwards, so a dropped connection loses nothing. When a threshold is crossed it does not wait for its next scheduled send: it sends immediately and records the five heaviest processes at that moment. It runs without special privileges and opens no port.
- **Collector.** The only door into the system. The agent presents a key; the collector works out which machine it is. A machine never gets to say who it is. The collector also hands out the commands you give from the dashboard (pause, resume, delete), which the agent fetches on its own.
- **Database.** Stores the data. Every user sees only their own machines. Data is kept for 10 days and then deleted.
- **Dashboard.** The page you open in a browser: your list of machines, and for each machine its charts, logs, crash markers and hardware details, streaming live. TraceBox shows facts; it does not judge and it does not send alerts. What counts as a problem is for you to decide.

---

## Türkçe

**Linux makineler için uzaktan kayıt ve izleme** — başına ne geldiğini size anlatacak kadar ayakta kalamayabilecek makineler için.

İzlenen makinede küçük bir agent çalışır ve makinenin metriklerini ile sistem loglarını sürekli olarak başka bir yere gönderir. Makine çöktüğünde, çöküşe giden anlar zaten başka bir yerde durur ve tarayıcıdan okunabilir. Uçağın kara kutusu gibi: son ana kadar kaydeder ve çöküşün ulaşamayacağı bir yerde durur.

### Nasıl başladı

Laptopum, bir Monster Abra A5 V20, her kapağı kapattığımda "ölmeye" başladı. Sabah kapağı açtığımda karşımda kapkara bir ekran oluyordu. Klavyeye basıyordum, hiçbir tepki yoktu. Tek çıkış yolu güç tuşuna basılı tutmaktı.

Bilgisayarı bir tamirciye götürdüm. Teşhis çabuk geldi: *"Anakart gitmiş, değişmesi lazım. Biraz tutar."* Bir şey bana ters geliyordu. Kapağı kapatmadığım sürece makine bütün gün sorunsuz çalışıyordu. Ölmekte olan bir anakartın kapakla ne derdi olabilirdi ki?

Parayı ödemeden önce tek bir şey denedim. Kapağı kapattım, açtım, kara ekrana baktım ve telefonumdan laptopa SSH ile bağlanmayı denedim.

**Cevap verdi.**

Makine ölmemişti. Donmamıştı bile. İşlemci boştaydı, sıcaklık normaldi, bütün servisler çalışıyordu. Uykudan kusursuz uyanmıştı, sadece ekranı yoktu. Gerisini loglar anlattı: tam uyanma anında NVIDIA sürücüsü ekran kartının belleğini geri yükleyememişti. Sürücü, uyku sırasında video belleğini korumak üzere ayarlanmıştı, ama bu kaydetme ve geri yükleme işini asıl yapan üç küçük systemd servisi hiç etkinleştirilmemişti.

Çözüm tek satırdı:

    sudo systemctl enable nvidia-suspend nvidia-resume nvidia-hibernate

Anakart falan yoktu.

#### Asıl ders

Sorunu bulmak günler sürdü, çözmek on saniye. Aradaki farkı yaratan tek şey **makinenin içinde ne olduğunu görebilmekti.** Ben şanslıydım: makine ayaktaydı ve içine girebildim. Ama gerçekten çöken bir makinede o loglar ya diskte kilitli kalır ya da güç tuşuyla birlikte kaybolur. Elinizde bir tek tamircinin sözü kalır.

TraceBox'ı bunun için geliştirdim. Makine kendini anlatamayacak hale gelmeden önce neler olduğunu dışarıya taşısın, böylece "anakart gitti" denildiğinde elinizde gerçek veri olsun diye.

### Sistemde neler var

- **Agent.** İzlenen makinede çalışan küçük bir program. CPU, RAM, disk, sıcaklık, swap, yük ve ekran kartını ölçer, sistem loglarını okur. Her şey önce yerel diske yazılır, sonra gönderilir; bağlantı kopsa bile hiçbir şey kaybolmaz. Bir eşik aşıldığında bir sonraki planlı göndermeyi beklemez: hemen gönderir ve o andaki en ağır beş süreci kaydeder. Özel yetki olmadan çalışır ve hiçbir port açmaz.
- **Collector.** Sisteme giriş yapılan tek kapı. Agent bir anahtar gösterir, collector hangi makine olduğunu kendisi çözer. Makine kim olduğunu kendisi söyleyemez. Dashboard'dan verdiğiniz komutları (duraklat, devam ettir, sil) da collector dağıtır; agent bunları kendisi gelip alır.
- **Veritabanı.** Veriyi saklar. Her kullanıcı yalnızca kendi makinelerini görür. Veri 10 gün tutulur, sonra silinir.
- **Dashboard.** Tarayıcıda açtığınız sayfa: makinelerinizin listesi ve her makine için grafikleri, logları, çöküş işaretleri ve donanım bilgisi; hepsi canlı akar. TraceBox olguyu gösterir; yargı bildirmez, alarm göndermez. Neyin sorun olduğuna siz karar verirsiniz.

---

## License

TraceBox is licensed under the TraceBox License v1.0.

See [LICENSE](./LICENSE) for the complete license terms.
