import {
  Activity,
  ArrowUpRight,
  Bike,
  BookOpenText,
  Dumbbell,
  HeartPulse,
  Layers3,
  MoveUpRight,
  PersonStanding,
  Weight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Header } from '../components/ui';
import { localized } from '../i18n';

const groups: {
  title: string;
  titleTh: string;
  description: string;
  descriptionTh: string;
  icon: LucideIcon;
  categories: { name: string; th: string }[];
}[] = [
  {
    title: 'Cardio & endurance',
    titleTh: 'คาร์ดิโอและความทนทาน',
    description:
      'Build heart and lung fitness with continuous movement. These machines vary by movement pattern, impact, and resistance.',
    descriptionTh:
      'ฝึกหัวใจและปอดด้วยการเคลื่อนไหวต่อเนื่อง แต่ละเครื่องต่างกันที่ท่าทาง แรงกระแทก และแรงต้าน',
    icon: HeartPulse,
    categories: [
      { name: 'Treadmills', th: 'ลู่วิ่ง' },
      { name: 'Skill Mill', th: 'ลู่วิ่งแรงต้านแบบไม่ใช้มอเตอร์' },
      { name: 'ClimbMill', th: 'เครื่องปีนบันได' },
      { name: 'Recumbent Bike', th: 'จักรยานเอนปั่น' },
      { name: 'Upright Bike', th: 'จักรยานนั่งตรง' },
      { name: 'Spinning Bike', th: 'จักรยานสปิน' },
      { name: 'Air Bike', th: 'จักรยานแรงต้านลม' },
      { name: 'Arm Bike', th: 'เครื่องปั่นแขน' },
      { name: 'Rowwing', th: 'เครื่องกรรเชียงบก' },
      { name: 'Elliptical', th: 'เครื่องเดินวงรี' },
      { name: 'Ski', th: 'เครื่องจำลองสกี' },
      { name: 'Stepper', th: 'เครื่องสเต็ป' },
    ],
  },
  {
    title: 'Selectorized & cable strength',
    titleTh: 'เครื่องเวทแบบเลือกน้ำหนักและเคเบิล',
    description:
      'Resistance comes from a weight stack or cable system. Pin selection makes it easy to adjust load and guide a specific movement.',
    descriptionTh:
      'ใช้แผ่นน้ำหนักในตัวหรือระบบเคเบิล ปรับน้ำหนักได้สะดวกและช่วยกำหนดแนวการเคลื่อนไหว',
    icon: Activity,
    categories: [
      { name: 'Machine Pin', th: 'เครื่องเวทแบบเลือกน้ำหนักด้วยสลัก' },
      { name: 'Station/Cable/Smith', th: 'เคเบิล สเตชัน และสมิทแมชชีน' },
    ],
  },
  {
    title: 'Plate-loaded strength',
    titleTh: 'เครื่องเวทแบบใส่แผ่นน้ำหนัก',
    description:
      'Load weight plates onto the machine. These machines often follow a fixed path while allowing larger, adjustable loads.',
    descriptionTh:
      'ใส่แผ่นน้ำหนักเข้ากับเครื่อง เส้นทางการเคลื่อนไหวมักถูกกำหนดไว้และรองรับการเพิ่มน้ำหนัก',
    icon: Layers3,
    categories: [
      { name: 'Plate Load', th: 'เครื่องเวทแบบใส่แผ่นน้ำหนัก' },
      { name: 'Plate', th: 'แผ่นน้ำหนัก' },
    ],
  },
  {
    title: 'Free weights & lifting stations',
    titleTh: 'ฟรีเวทและสถานียกน้ำหนัก',
    description:
      'Free weights let the user control more of the movement. Racks and benches provide support for strength exercises.',
    descriptionTh:
      'ฟรีเวทช่วยให้ผู้ฝึกควบคุมการเคลื่อนไหวมากขึ้น ส่วนแร็กและม้านั่งช่วยรองรับท่าฝึกแรงต้าน',
    icon: Weight,
    categories: [
      { name: 'Dumbbell', th: 'ดัมเบล' },
      { name: 'Dumbbell+Rack', th: 'ดัมเบลพร้อมแร็ก' },
      { name: 'Barbell+Rack', th: 'บาร์เบลพร้อมแร็ก' },
      { name: 'Rack', th: 'แร็กและแท่นยก' },
      { name: 'Bench', th: 'ม้านั่งออกกำลังกาย' },
    ],
  },
  {
    title: 'Pilates & accessories',
    titleTh: 'พิลาทิสและอุปกรณ์เสริม',
    description:
      'Pilates equipment supports controlled movement and core training. Accessories add variety, comfort, and support to workouts.',
    descriptionTh:
      'อุปกรณ์พิลาทิสช่วยฝึกการเคลื่อนไหวอย่างควบคุมและกล้ามเนื้อแกนกลาง อุปกรณ์เสริมช่วยเพิ่มความหลากหลาย',
    icon: PersonStanding,
    categories: [
      { name: 'Pilatis', th: 'พิลาทิส' },
      { name: 'Accessories', th: 'อุปกรณ์เสริม' },
    ],
  },
  {
    title: 'Other equipment',
    titleTh: 'อุปกรณ์ประเภทอื่นๆ',
    description:
      'Use this category for equipment that does not fit the groups above. Add a clear name and description to help the team identify it.',
    descriptionTh:
      'ใช้กับสินค้าที่ไม่เข้ากลุ่มด้านบน ควรระบุชื่อและรายละเอียดให้ทีมเข้าใจตรงกัน',
    icon: Dumbbell,
    categories: [{ name: 'Other', th: 'อื่นๆ' }],
  },
];

const formats = [
  {
    title: 'Cardio / aerobic',
    titleTh: 'คาร์ดิโอ / แอโรบิก',
    description: 'Continuous movement that raises heart rate, such as walking, cycling, rowing, or climbing.',
    descriptionTh: 'การเคลื่อนไหวต่อเนื่องเพื่อเพิ่มการทำงานของหัวใจ เช่น เดิน ปั่นจักรยาน กรรเชียง หรือปีนบันได',
    icon: Bike,
  },
  {
    title: 'Resistance / strength',
    titleTh: 'ฝึกแรงต้าน / เสริมสร้างกล้ามเนื้อ',
    description: 'Exercises against resistance from a machine, cable, weight plates, dumbbells, or a barbell.',
    descriptionTh: 'การออกแรงต้านกับเครื่อง เคเบิล แผ่นน้ำหนัก ดัมเบล หรือบาร์เบล',
    icon: Dumbbell,
  },
  {
    title: 'Mobility / controlled movement',
    titleTh: 'ฝึกการเคลื่อนไหว / ควบคุมร่างกาย',
    description: 'Controlled movement, balance, and range-of-motion work, often supported by Pilates equipment or accessories.',
    descriptionTh: 'การฝึกการทรงตัว การควบคุมร่างกาย และช่วงการเคลื่อนไหว มักใช้อุปกรณ์พิลาทิสหรืออุปกรณ์เสริม',
    icon: MoveUpRight,
  },
];

export function EquipmentGuidePage() {
  const categoryCount = groups.reduce(
    (total, group) => total + group.categories.length,
    0,
  );

  return (
    <>
      <Header
        title={localized('Fitness equipment guide', 'คู่มือเครื่องออกกำลังกาย')}
        subtitle={localized(
          'A practical guide to the main equipment types, how they work, and where to find them in your inventory.',
          'ทำความรู้จักประเภทเครื่องออกกำลังกาย หลักการทำงาน และเลือกดูสินค้าที่เกี่ยวข้องในคลังได้จากหน้านี้',
        )}
      />
      <section className="guide-intro panel">
        <div className="guide-intro-icon"><BookOpenText size={24} /></div>
        <div>
          <strong>{localized('How many types are there?', 'เครื่องออกกำลังกายมีกี่ประเภท?')}</strong>
          <p>
            {localized(
              `There is no single universal count. For this system, equipment is organized into ${groups.length} main groups and ${categoryCount} inventory categories. For training, the simplest view is 3 formats: cardio, resistance, and mobility / controlled movement.`,
              `ไม่มีจำนวนประเภทที่เป็นมาตรฐานตายตัว ในระบบนี้แบ่งเพื่อให้ง่ายต่อการเรียนรู้เป็น ${groups.length} กลุ่มหลัก ครอบคลุม ${categoryCount} หมวดหมู่สินค้า ส่วนรูปแบบการฝึกหลักแบ่งได้ 3 แบบ คือ คาร์ดิโอ ฝึกแรงต้าน และฝึกการเคลื่อนไหวหรือความยืดหยุ่น`,
            )}
          </p>
        </div>
      </section>

      <section className="guide-formats" aria-label={localized('Training formats', 'รูปแบบการฝึก')}>
        {formats.map(({ title, titleTh, description, descriptionTh, icon: Icon }) => (
          <article className="guide-format panel" key={title}>
            <span className="guide-format-icon"><Icon size={19} /></span>
            <div>
              <h2>{localized(title, titleTh)}</h2>
              <p>{localized(description, descriptionTh)}</p>
            </div>
          </article>
        ))}
      </section>

      <div className="section-heading guide-heading">
        <div>
          <h2>{localized('Main equipment groups', 'ประเภทเครื่องออกกำลังกาย')}</h2>
          <p>{localized('Select a category to see matching items in the inventory.', 'เลือกหมวดหมู่เพื่อดูสินค้าที่เกี่ยวข้องในคลัง')}</p>
        </div>
      </div>
      <section className="guide-grid">
        {groups.map(({ title, titleTh, description, descriptionTh, icon: Icon, categories }, index) => (
          <article className={`guide-card panel guide-accent-${index + 1}`} key={title}>
            <div className="guide-card-heading">
              <span className="guide-icon"><Icon size={20} /></span>
              <div>
                <small>{localized(`GROUP ${index + 1}`, `กลุ่มที่ ${index + 1}`)}</small>
                <h2>{localized(title, titleTh)}</h2>
              </div>
            </div>
            <p>{localized(description, descriptionTh)}</p>
            <div className="guide-categories">
              {categories.map(({ name, th }) => (
                <Link className="guide-category" to={`/inventory?category=${encodeURIComponent(name)}`} key={name}>
                  {localized(name, th)}
                  <ArrowUpRight size={13} />
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
