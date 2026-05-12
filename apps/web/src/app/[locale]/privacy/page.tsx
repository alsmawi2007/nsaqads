import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/lib/i18n/navigation';
import { getBrand } from '@/config/brand';

type Locale = 'en' | 'ar';
const SUPPORTED: Locale[] = ['en', 'ar'];

interface PrivacyPageProps {
  params: Promise<{ locale: string }>;
}

const LAST_UPDATED = '2026-05-12';
const CONTACT_EMAIL = 'privacy@nsqads.ai';

export async function generateMetadata({ params }: PrivacyPageProps): Promise<Metadata> {
  const { locale } = await params;
  const title = locale === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy';
  return { title };
}

export default async function PrivacyPage({ params }: PrivacyPageProps) {
  const { locale: raw } = await params;
  if (!SUPPORTED.includes(raw as Locale)) notFound();
  const locale = raw as Locale;
  const brand = getBrand(locale);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href={'/' as '/'} className="text-lg font-bold text-brand-600">
            {brand.name}
          </Link>
          <LocaleSwitch current={locale} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <article
          className={[
            'text-sm leading-relaxed text-slate-700 dark:text-slate-300',
            '[&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-slate-900 dark:[&_h1]:text-slate-100',
            '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 dark:[&_h2]:text-slate-100',
            '[&_p]:mb-4',
            '[&_ul]:mb-4 [&_ul]:ms-5 [&_ul]:list-disc [&_ul]:space-y-1.5',
            '[&_a]:text-brand-600 [&_a]:underline hover:[&_a]:text-brand-700 dark:[&_a]:text-brand-400',
            '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_code]:text-slate-800 dark:[&_code]:bg-slate-800 dark:[&_code]:text-slate-200',
            '[&_strong]:font-semibold [&_strong]:text-slate-900 dark:[&_strong]:text-slate-100',
          ].join(' ')}
        >
          {locale === 'ar' ? <ArabicContent /> : <EnglishContent />}
        </article>

        <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {locale === 'ar'
            ? `آخر تحديث: ${LAST_UPDATED}. للاستفسارات: ${CONTACT_EMAIL}.`
            : `Last updated: ${LAST_UPDATED}. Questions: ${CONTACT_EMAIL}.`}
        </footer>
      </main>
    </div>
  );
}

function LocaleSwitch({ current }: { current: Locale }) {
  const other: Locale = current === 'en' ? 'ar' : 'en';
  const label = other === 'en' ? 'EN' : 'العربية';
  return (
    <a
      href={`/${other}/privacy`}
      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {label}
    </a>
  );
}

// ─── English ──────────────────────────────────────────────────────────────────

function EnglishContent() {
  return (
    <>
      <h1>Privacy Policy</h1>

      <p>
        Nasaq Ads (نسق ادز, &quot;<strong>Nasaq Ads</strong>&quot;, &quot;<strong>we</strong>&quot;,
        &quot;<strong>our</strong>&quot;) is a server-to-server advertising performance and
        optimization platform for businesses managing paid campaigns on
        Meta, Google Ads, Snapchat, and TikTok. This policy explains what
        data we collect, how we use it, how we secure it, and what rights
        you have.
      </p>

      <h2>1. Who this policy applies to</h2>
      <p>
        This policy applies to <strong>advertiser organizations</strong> and their
        authorized users who sign in to Nasaq Ads at <code>app.nsqads.ai</code>
        and connect ad-platform accounts. Nasaq Ads does not process data
        about end-users of the underlying ad platforms (for example, Snapchatters
        or Facebook users) beyond aggregated, ad-account-scoped performance
        metrics that those platforms expose via their official APIs.
      </p>

      <h2>2. Data we collect from you (the advertiser)</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Email, name, hashed password,
          preferred language, organization membership and role.
        </li>
        <li>
          <strong>OAuth credentials for connected ad platforms.</strong> When you
          connect a Snapchat, Meta, Google Ads, or TikTok ad account through
          OAuth, we store the <em>access token</em> and <em>refresh token</em>
          returned by the platform. Tokens are encrypted at rest using
          AES-256-GCM and used only to call the corresponding platform&apos;s
          official API on your behalf.
        </li>
        <li>
          <strong>Audit logs.</strong> Authentication events, configuration
          changes, and optimizer actions taken on your campaigns. Used for
          security, compliance, and to power the &quot;recent activity&quot; views
          inside the product.
        </li>
      </ul>

      <h2>3. Data we read from advertising platforms</h2>
      <p>
        Once you authorize a connection, Nasaq Ads reads only what the
        granted OAuth scope allows, scoped to the specific ad accounts you
        own:
      </p>
      <ul>
        <li>Ad account metadata (id, name, currency, timezone, status).</li>
        <li>Campaign, ad-set/ad-squad/ad-group, and ad metadata (id, name, status, objective, budget, bidding strategy, schedule).</li>
        <li>Performance metrics (spend, impressions, clicks, conversions, conversion value, frequency, reach) aggregated at the campaign / ad-set level.</li>
      </ul>
      <p>
        We do <strong>not</strong> request, store, or process individual end-user
        identifiers, profiles, messages, content, contact lists, or any
        personal data of the platform&apos;s own users.
      </p>

      <h2>4. How we use the data</h2>
      <ul>
        <li>To display campaign performance dashboards inside Nasaq Ads.</li>
        <li>To generate <em>suggestions</em> for budget, bidding, and pacing changes.</li>
        <li>To apply changes <strong>only after explicit advertiser approval</strong> when AUTO_APPLY mode is not enabled.</li>
        <li>To detect anomalies and alert advertisers about budget exhaustion, CPA spikes, and similar conditions.</li>
        <li>To compute aggregate, anonymized insights that improve the optimizer&apos;s rules over time (Historical Learning Layer).</li>
      </ul>
      <p>
        We do not sell your data. We do not share it with advertisers other
        than the organization that owns the data. We do not use connected
        ad-account data to train third-party models.
      </p>

      <h2>5. Data security</h2>
      <ul>
        <li>All HTTP traffic is TLS-encrypted (Let&apos;s Encrypt, HSTS).</li>
        <li>OAuth client secrets, state-signing secrets, refresh tokens, and access tokens are encrypted at rest with AES-256-GCM (NIST-approved).</li>
        <li>API responses are scrubbed of secret values; admin endpoints return only fingerprint last-4 characters.</li>
        <li>Access to the Nasaq Ads infrastructure is limited to authorized engineers using key-based SSH and is fully audit-logged.</li>
        <li>Production database backups are encrypted and retained per the schedule below.</li>
      </ul>

      <h2>6. Data retention</h2>
      <ul>
        <li>Account and organization data: retained while your organization is active and for 30 days after deletion of the organization, then purged.</li>
        <li>OAuth tokens: deleted immediately when you disconnect a platform from the Nasaq Ads settings.</li>
        <li>Performance metrics and audit logs: retained for 13 months to support year-over-year reporting, then purged.</li>
      </ul>

      <h2>7. Your rights</h2>
      <p>
        You can at any time:
      </p>
      <ul>
        <li>Disconnect a connected ad platform from <em>Settings → Providers</em>. Doing so deletes the stored tokens and stops all future API calls to that platform.</li>
        <li>Request export or deletion of your account data by emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
        <li>Revoke Nasaq Ads&apos; access from the connected platform&apos;s own settings page (Snapchat Business Manager, Meta Business Settings, Google Ads Manager, TikTok Business Center). Revocation propagates to Nasaq Ads on the next API call (within minutes).</li>
      </ul>

      <h2>8. Third-party services</h2>
      <p>
        Nasaq Ads connects to the following third-party APIs strictly on
        your behalf and within the OAuth scope you grant:
      </p>
      <ul>
        <li>Snapchat Marketing API — <a href="https://snap.com/en-US/privacy/privacy-policy">snap.com/en-US/privacy/privacy-policy</a></li>
        <li>Meta Marketing API — <a href="https://www.facebook.com/privacy/policy/">facebook.com/privacy/policy</a></li>
        <li>Google Ads API — <a href="https://policies.google.com/privacy">policies.google.com/privacy</a></li>
        <li>TikTok Marketing API — <a href="https://www.tiktok.com/legal/privacy-policy">tiktok.com/legal/privacy-policy</a></li>
      </ul>

      <h2>9. Changes to this policy</h2>
      <p>
        We will post any changes on this page and update the &quot;Last updated&quot;
        date below. Material changes will additionally be communicated to
        organization admins by email at least 14 days before they take
        effect.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions, requests, or concerns: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}

// ─── Arabic ──────────────────────────────────────────────────────────────────

function ArabicContent() {
  return (
    <>
      <h1>سياسة الخصوصية</h1>

      <p>
        نسق ادز (Nasaq Ads — &quot;<strong>نسق ادز</strong>&quot; أو &quot;<strong>نحن</strong>&quot;)
        هي منصة server-to-server لتحسين أداء الحملات الإعلانية المدفوعة على
        Meta و Google Ads و Snapchat و TikTok. توضح هذه السياسة البيانات
        التي نجمعها، وطريقة استخدامها، وكيف نؤمنها، وما هي حقوقك.
      </p>

      <h2>1. لمن تنطبق هذه السياسة</h2>
      <p>
        تنطبق على <strong>المنظمات المعلنة</strong> ومستخدميها المخوّلين الذين
        يسجّلون الدخول إلى نسق ادز على <code>app.nsqads.ai</code> ويربطون
        حسابات إعلانية. لا تعالج نسق ادز بيانات المستخدمين النهائيين للمنصات
        الإعلانية (مثل مستخدمي Snapchat أو Facebook) خارج المقاييس المجمّعة
        على مستوى الحساب الإعلاني والمتاحة عبر الـAPI الرسمي للمنصة.
      </p>

      <h2>2. البيانات التي نجمعها منك (المعلِن)</h2>
      <ul>
        <li>
          <strong>بيانات الحساب.</strong> البريد، الاسم، كلمة المرور (مشفّرة Hash)،
          اللغة المفضّلة، عضوية المنظمة والدور.
        </li>
        <li>
          <strong>بيانات OAuth للمنصات المربوطة.</strong> عند ربط حساب Snap أو Meta
          أو Google Ads أو TikTok عبر OAuth، نخزّن الـaccess token و
          الـrefresh token اللذين تُصدرهما المنصة. هذه التوكينات مشفّرة في
          قاعدة البيانات باستخدام AES-256-GCM، وتُستخدم فقط لاستدعاء الـAPI
          الرسمي للمنصة نيابةً عنك.
        </li>
        <li>
          <strong>سجلات التدقيق.</strong> أحداث المصادقة، تغييرات الإعدادات،
          والإجراءات التي ينفّذها المحسّن على حملاتك. تُستخدم للأمان والامتثال
          وعرض النشاط الأخير داخل المنتج.
        </li>
      </ul>

      <h2>3. البيانات التي نقرأها من المنصات الإعلانية</h2>
      <p>
        بعد منح الإذن، تقرأ نسق ادز فقط ما تسمح به صلاحية OAuth الممنوحة،
        ومحصورة بالحسابات الإعلانية التي تملكها:
      </p>
      <ul>
        <li>بيانات الحساب الإعلاني (المعرّف، الاسم، العملة، المنطقة الزمنية، الحالة).</li>
        <li>بيانات الحملات والمجموعات الإعلانية والإعلانات (المعرّف، الاسم، الحالة، الهدف، الميزانية، استراتيجية المزايدة، الجدولة).</li>
        <li>مقاييس الأداء (الإنفاق، الانطباعات، النقرات، التحويلات، قيمة التحويل، التكرار، الوصول) مجمّعة على مستوى الحملة / المجموعة.</li>
      </ul>
      <p>
        <strong>لا نطلب أو نخزّن أو نعالج</strong> أي معرّفات أو ملفّات شخصية أو
        رسائل أو محتوى أو جهات اتصال أو أي بيانات شخصية لمستخدمي المنصة
        النهائيين.
      </p>

      <h2>4. كيف نستخدم البيانات</h2>
      <ul>
        <li>لعرض لوحات أداء الحملات داخل نسق ادز.</li>
        <li>لتوليد <em>اقتراحات</em> لتعديل الميزانية والمزايدة والإيقاع.</li>
        <li>لتطبيق التغييرات <strong>فقط بعد موافقة المعلِن الصريحة</strong> إذا لم يتم تفعيل وضع AUTO_APPLY.</li>
        <li>لاكتشاف الشذوذ وتنبيه المعلِن عن نفاد الميزانية أو ارتفاع CPA وما شابه.</li>
        <li>لحساب رؤى مجمّعة ومجهولة الهوية لتحسين قواعد المحسّن مع الوقت (طبقة التعلّم التاريخي).</li>
      </ul>
      <p>
        لا نبيع بياناتك. لا نشاركها مع معلِنين آخرين خارج المنظمة المالكة.
        لا نستخدم بيانات الحسابات المربوطة لتدريب نماذج طرف ثالث.
      </p>

      <h2>5. أمان البيانات</h2>
      <ul>
        <li>كل حركة HTTP مشفّرة بـTLS (Let&apos;s Encrypt + HSTS).</li>
        <li>أسرار OAuth وتوكينات الـrefresh والـaccess مشفّرة في قاعدة البيانات بـAES-256-GCM (المعتمد من NIST).</li>
        <li>ردود الـAPI تُجرَّد من قيم الأسرار؛ نقاط الـadmin تُرجع آخر 4 أحرف فقط كبصمة.</li>
        <li>الوصول للبنية التحتية محصور بالمهندسين المخوّلين عبر SSH بمفتاح، ومُسجَّل بالكامل في audit log.</li>
        <li>النسخ الاحتياطية لقاعدة البيانات الإنتاجية مشفّرة ومحتفظ بها حسب الجدول أدناه.</li>
      </ul>

      <h2>6. الاحتفاظ بالبيانات</h2>
      <ul>
        <li>بيانات الحساب والمنظمة: محفوظة طالما المنظمة نشطة و30 يوماً بعد حذفها، ثم تُمحى.</li>
        <li>توكينات OAuth: تُحذف فوراً عند فصل المنصة من إعدادات نسق ادز.</li>
        <li>مقاييس الأداء وسجلات التدقيق: محفوظة لمدة 13 شهراً لدعم المقارنة السنوية، ثم تُمحى.</li>
      </ul>

      <h2>7. حقوقك</h2>
      <p>تقدر في أي وقت:</p>
      <ul>
        <li>فصل أي منصة مربوطة من <em>الإعدادات ← المزودون</em>. الفصل يحذف التوكينات المخزّنة ويوقف كل المكالمات المستقبلية لتلك المنصة.</li>
        <li>طلب تصدير أو حذف بيانات حسابك بإرسال بريد إلى <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
        <li>سحب صلاحية نسق ادز من إعدادات المنصة نفسها (Snapchat Business Manager، Meta Business Settings، Google Ads Manager، TikTok Business Center). يصل الإلغاء إلى نسق ادز عند أول مكالمة API بعده (دقائق).</li>
      </ul>

      <h2>8. خدمات الطرف الثالث</h2>
      <p>تتصل نسق ادز بـAPIs الطرف الثالث التالية حصرياً نيابةً عنك وضمن صلاحية OAuth الممنوحة:</p>
      <ul>
        <li>Snapchat Marketing API — <a href="https://snap.com/en-US/privacy/privacy-policy">snap.com/en-US/privacy/privacy-policy</a></li>
        <li>Meta Marketing API — <a href="https://www.facebook.com/privacy/policy/">facebook.com/privacy/policy</a></li>
        <li>Google Ads API — <a href="https://policies.google.com/privacy">policies.google.com/privacy</a></li>
        <li>TikTok Marketing API — <a href="https://www.tiktok.com/legal/privacy-policy">tiktok.com/legal/privacy-policy</a></li>
      </ul>

      <h2>9. تغييرات على هذه السياسة</h2>
      <p>
        ننشر أي تغييرات على هذه الصفحة ونحدّث تاريخ &quot;آخر تحديث&quot; أدناه.
        التغييرات الجوهرية تُبلَّغ لمسؤولي المنظمة بالبريد قبل 14 يوماً على
        الأقل من بدء العمل بها.
      </p>

      <h2>10. التواصل</h2>
      <p>أي استفسار أو طلب: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
    </>
  );
}
