/* Recruiter keywords: read a pasted job post and find the terms a recruiter or an ATS screens for.

   Pure functions, no DOM, so tests/test_keywords.py runs them under Node. index.html loads this
   after scoring.js.

   How it works
     1. The post is cut into lines and sentences. Headings ("Requirements", "Preferred",
        "Responsibilities", "Benefits") decide how much a line matters.
     2. A curated lexicon of about 550 skills across many fields (software, testing, IT, MIS and
        data, business, banking, legal, engineering and maintenance, NGO, HR, sales, media,
        health, education, soft skills, degrees) is matched against every line. Each entry lists
        the ways people actually write it ("MS Excel", "Microsoft Excel", "Advanced Excel"), and
        the wording the post used is what gets printed, because that is what an ATS matches.
     3. No list can hold every field, so the rest is read from the post itself: runs of
        meaningful words between stop words and punctuation ("preventive maintenance", "dispute
        resolution"), kept only when the post signals they matter (they repeat, follow
        "experience with", or are a short requirement line). Nothing here assumes a field.
     4. Each keyword gets a tier: must-have (under a requirements heading, near "must" or
        "required", or in the job title), important (in the duties), or nice-to-have ("a plus",
        "preferred").

   The rule that matters: the candidate decides. Every keyword starts undecided; it is on the resume
   only after they press Add (pickForResume). annotateKeywords records whether their own profile backs
   each one (skills / prose / none) so the choice is informed, but that never decides for them.
*/

// One entry per line: Canonical|alias|alias. The first name is what the entry is called.
// "=" in front means match case-sensitively (for words that are also ordinary English).
// "#!kind" switches the kind for the lines below: tech (default), soft, degree.
const KW_LEXICON=`
#!tech
JavaScript|ECMAScript|Java Script
TypeScript
Python
Java
C++
C#
C Programming|C Language
PHP
Ruby
Golang
Kotlin
=Swift
Dart
R Programming|=R Language
MATLAB
=Rust
Scala
Perl
VBA|Visual Basic
Bash|Shell Scripting|Shell Script
PowerShell
SQL
PL/SQL
T-SQL
HTML|HTML5
CSS|CSS3
SASS|SCSS
React|React.js|ReactJS
Angular|AngularJS
Vue.js|VueJS|Vue
Next.js|NextJS
Node.js|NodeJS|Node JS
Express.js|ExpressJS
Laravel
CodeIgniter
Django
Flask
FastAPI
Spring Boot|Spring Framework
.NET|ASP.NET|.NET Core|ASP.NET Core|ASP.NET MVC
jQuery
Bootstrap
Tailwind CSS|Tailwind
WordPress
WooCommerce
Shopify
Magento
Flutter
React Native
Android|Android Development
iOS|iOS Development
Redux
MySQL
PostgreSQL|Postgres
Oracle|Oracle Database|Oracle DB
SQL Server|MSSQL|MS SQL|Microsoft SQL Server
MongoDB
SQLite
Redis
Firebase
Elasticsearch
NoSQL
RDBMS|Relational Database|Relational Databases
Database Design|Database Development
Database Management|DBMS|Database Administration|DBA
Data Modeling|Data Modelling
Normalization|Database Normalization
ER Diagram|ERD|Entity Relationship Diagram|ER Modeling|ER Modelling
Stored Procedures|Stored Procedure
Query Optimization|Query Tuning|Performance Tuning
Data Warehouse|Data Warehousing
ETL
REST API|RESTful API|REST APIs|RESTful APIs|RESTful|=REST|Web API|Web APIs
=API|=APIs|API Integration|API Development
GraphQL
JSON
AJAX
Microservices|Micro Services
Web Services|Web Service|SOAP
OOP|Object Oriented Programming|Object Oriented Design|OOD
MVC
Data Structures|Data Structure|Data Structures and Algorithms|DSA
Algorithms|Algorithm
Design Patterns|Design Pattern
Software Development|Software Engineering
Web Development|Web Application Development|Web Applications|Web Application
Mobile App Development|Mobile Application Development|App Development|Mobile Development
Full Stack|Full Stack Development|Full Stack Developer
Front End|Frontend|Front End Development|Frontend Development
Back End|Backend|Back End Development|Backend Development
Responsive Design|Responsive Web Design
UI/UX|UX Design|UI Design|User Interface|User Experience|UI UX
Figma
Adobe Photoshop|Photoshop
Adobe XD|=XD
SEO|Search Engine Optimization|Search Engine Optimisation
Debugging|Code Review
Version Control
Form Validation|Input Validation
Artificial Intelligence|=AI
Machine Learning|=ML
Deep Learning
Data Science
NLP|Natural Language Processing
Computer Vision
Pandas
NumPy
TensorFlow
PyTorch
Scikit-learn|Sklearn
Git
GitHub
GitLab
Bitbucket
Docker
Kubernetes
CI/CD|CI CD|Continuous Integration|Continuous Delivery
Jenkins
AWS|Amazon Web Services
Azure|Microsoft Azure
Google Cloud|GCP
Cloud Computing
Linux
Unix
Windows Server
Nginx
Apache|Apache Server
cPanel|Web Hosting|Hosting Panel|Hosting Management|Hosting Services
DNS
SSL|SSL Certificates|TLS
Networking|Computer Networking|Network Administration
TCP/IP
Cisco|CCNA|CCNP
Active Directory
VPN
Firewall|Firewalls
Virtualization|Virtualisation|VMware|Hyper-V
Cybersecurity|Cyber Security|Information Security|Network Security
Manual Testing
Automation Testing|Test Automation|Automated Testing
Selenium|Selenium WebDriver
Cypress
Playwright
Postman
JMeter
Appium
Test Cases|Test Case|Test Case Design|Test Case Writing
Test Plan|Test Planning|Test Plans
Test Scenarios|Test Scenario
Test Strategy
Test Execution
Regression Testing
Functional Testing
Smoke Testing
Sanity Testing
Integration Testing
System Testing
UAT|User Acceptance Testing
Performance Testing|Load Testing|Stress Testing
API Testing
Cross Browser Testing|Cross Browser Compatibility
Mobile Testing|Mobile App Testing
Usability Testing
Exploratory Testing
Black Box Testing
White Box Testing
Unit Testing
Bug Tracking|Defect Tracking|Defect Management|Bug Reporting|Defect Reporting|Bug Report
Bug Life Cycle|Defect Life Cycle
JIRA
TestRail
STLC|Software Testing Life Cycle
Quality Assurance|=QA|=SQA|Software Quality Assurance|QA Testing
Software Testing
Agile|Agile Methodology|Agile Methodologies
Scrum
Kanban
Waterfall
SDLC|Software Development Life Cycle
Sprint Planning
SRS|Software Requirements Specification
Requirements Gathering|Requirement Gathering|Requirements Analysis|Requirement Analysis|Requirements Elicitation
Use Cases|Use Case
User Stories|User Story
UML
BPMN
Process Mapping|Process Modeling|Process Modelling|Process Flow
Gap Analysis
BRD|Business Requirements|Business Requirement|Business Requirement Document
FRS|Functional Specification|Functional Requirements|Functional Requirement
Wireframing|Wireframes|Wireframe
Prototyping
System Analysis|Systems Analysis
System Design|Systems Design
Feasibility Study
Risk Analysis|Risk Assessment|Risk Management
Change Management
Process Improvement|Continuous Improvement
Root Cause Analysis|RCA
Documentation|Technical Documentation
SOP|Standard Operating Procedures|Standard Operating Procedure
ITIL
ISO 27001
ISO 9001
Six Sigma|Lean Six Sigma|Lean Management
PMP
PRINCE2
Technical Support|Tech Support
Troubleshooting|Trouble Shooting
Help Desk|Helpdesk|Service Desk
IT Support
Desktop Support
Hardware Troubleshooting|Hardware Maintenance|Hardware Support
Software Installation
System Administration|System Administrator|Sysadmin|Server Administration|Server Management
Backup and Recovery|Data Backup|Disaster Recovery
Incident Management|Incident Response
Ticketing System|Ticketing Tools|Ticketing
L1 Support|L2 Support|Level 1 Support|Level 2 Support
Application Support|Production Support
CCTV
Server Migration
MIS|Management Information System|Management Information Systems
=Excel|MS Excel|Microsoft Excel|Advanced Excel|Excel Formulas|Excel Formula|Excel Reports
VLOOKUP|HLOOKUP|XLOOKUP|Lookup Functions
Pivot Table|PivotTable
Excel Macros|Macros
Power BI|PowerBI
Tableau
Google Sheets
Looker Studio|Google Data Studio
Data Analysis|Data Analytics|Analytical Reporting
Data Visualization|Data Visualisation
Data Entry
Data Management
Data Cleaning|Data Cleansing|Data Validation
Data Reconciliation|Reconciliation
Data Mining
Dashboard|Dashboard Development
MIS Reporting|MIS Report|Report Generation|Report Preparation|Management Reporting|Data Reporting|Business Reporting|Daily Reports|Daily Report|Weekly Reports|Weekly Report|Monthly Reports|Monthly Report
KPI|Key Performance Indicators|Key Performance Indicator
Business Intelligence|=BI
Statistics|Statistical Analysis
SPSS
Stata
SAS
Power Query
DAX
Google Analytics
Data Governance
Data Quality
Master Data
Business Development
Sales|Sales Strategy|Sales Management|B2B Sales|Direct Sales
Marketing|Marketing Strategy|Marketing Campaigns|Campaign Management
Digital Marketing
Social Media Marketing|Social Media Management|Social Media
Content Writing|Content Creation|Copywriting|Content Marketing
Email Marketing
Market Research
Brand Management|Branding
CRM|Customer Relationship Management|Salesforce
Customer Service|Customer Support|Customer Care|Customer Experience
Client Relationship|Client Management|Client Handling|Client Communication
Account Management|Key Account Management
Supply Chain|Supply Chain Management|SCM
Logistics
Procurement|Purchasing|Sourcing
Inventory Management|Inventory Control|Stock Management
Operations Management|Operational Excellence|Operations Planning
Project Management|Project Coordination|Project Planning
Stakeholder Management|Stakeholder Communication|Stakeholder Engagement
Vendor Management|Vendor Coordination|Supplier Management
Budgeting|Budget Management|Budget Planning
Financial Analysis|Financial Reporting|Financial Modeling|Financial Modelling|Financial Statements|Financial Statement
Accounting|Accounts Payable|Accounts Receivable
Bookkeeping
Tally
QuickBooks
Auditing|Internal Audit|Audit
Taxation|VAT|Tax
Human Resources|=HR|HR Management
Recruitment|Talent Acquisition|Recruiting
Payroll
Compliance|Regulatory Compliance
Business Strategy|Strategic Planning|Strategy Development
Business Analysis|Business Analytics
Market Analysis|Competitor Analysis|Competitive Analysis
Negotiation|Negotiation Skills
Lead Generation|Prospecting
Cold Calling
Product Management|Product Development
ERP|=SAP|Odoo|Microsoft Dynamics|Oracle ERP
Cross Functional Collaboration|Cross Functional Teams|Cross Functional Team|Cross Functional
Team Management|Team Leadership|People Management
Leadership|Leadership Skills|Leadership Development
Decision Making|Strategic Thinking
Sales Targets|Sales Target|Target Achievement|Achieving Targets
Banking|Financial Services
FMCG
Fintech|Mobile Financial Services|MFS
E-Commerce|Ecommerce
KYC|AML|Know Your Customer
Microsoft Office|MS Office|Office Suite|Microsoft Office Suite|MS Office Suite
MS Word|Microsoft Word|=Word
MS PowerPoint|Microsoft PowerPoint|PowerPoint
=Outlook|MS Outlook|Microsoft Outlook
Google Workspace|Google Docs|G Suite|Google Suite
Trello
Asana
Slack
Confluence
=Notion
Visio|MS Visio
Adobe Illustrator|Illustrator
Adobe Premiere|Premiere Pro
Canva
AutoCAD|Auto CAD
SolidWorks
Revit
ETABS
STAAD Pro|STAAD
SketchUp
3D Modeling|3D Modelling
CAD|Computer Aided Design
MS Project|Microsoft Project|Primavera
Structural Analysis|Structural Design
Site Supervision|Site Management|Construction Supervision
Quantity Surveying|Bill of Quantities|BOQ
Construction Management
Cost Estimation|Project Estimation
Electrical Maintenance
Programmable Logic Controller|PLC Programming
SCADA
Circuit Design
Power Systems
Preventive Maintenance
Predictive Maintenance
Machine Maintenance|Equipment Maintenance
Calibration
HVAC
Quality Control|=QC
Quality Management System|QMS
GMP|Good Manufacturing Practice|Good Manufacturing Practices
HACCP
Lean Manufacturing
5S
Kaizen
Total Productive Maintenance|TPM
Production Planning
Production Management|Production Supervision
Occupational Health and Safety|OHS|Health and Safety|HSE|EHS
Fire Safety
Lockout Tagout|LOTO
Safety Compliance
Welding
CNC
Technical Drawing|Engineering Drawing
Warehouse Management|Warehousing
Import and Export|Import Export|Customs Clearance|Shipping Documentation|Freight Forwarding
Letter of Credit|=LC
Merchandising|Merchandiser|Knit Merchandising
Buying House
Garments|Apparel|RMG|Readymade Garments
Textile
Cost Control|Costing
Credit Analysis|Credit Assessment|Credit Appraisal
Credit Risk|Credit Risk Management
Loan Processing|Loan Disbursement|Loan Recovery
SME Banking|SME Financing
Trade Finance
Retail Banking
Treasury
Financial Planning|Financial Planning and Analysis|FP&A
Cash Flow|Cash Management
IFRS|International Financial Reporting Standards
GAAP
Bank Reconciliation
Investment Analysis|Portfolio Management
Insurance|Underwriting|Claims Processing
Chartered Accountant|Chartered Accountancy|ACCA|CFA|CMA|ICAB
Financial Audit|External Audit
Cost Accounting|Management Accounting
Legal Advisory|Legal Advice|Legal Support
Contract Drafting|Contract Review|Contract Management|Commercial Contracts
Commercial Law
Employment Law|Labour Law|Labor Law
Corporate Law|Company Law
Intellectual Property|Trademark
Litigation|Dispute Resolution|Arbitration
Legal Research
Regulatory Affairs
Data Protection
Legal Drafting|Drafting
Lesson Planning
Curriculum Development|Curriculum Design
Classroom Management
Teaching|Teaching Experience
Student Assessment
E-Learning|Online Teaching
Training and Development|Training Delivery|Corporate Training|Learning and Development
Research Methodology
Patient Care
Clinical Research|Clinical Trials
Nursing|Nursing Care
Pharmacovigilance
Medical Representative|Medical Sales
First Aid
Infection Control
Graphic Design
Video Editing
Adobe After Effects|After Effects
Adobe InDesign|InDesign
Motion Graphics
Photography
Proofreading|Copy Editing
Content Strategy
Public Relations|=PR
Media Buying|Media Planning
Google Ads|Google AdWords|Meta Ads|Meta Ads Manager|Facebook Ads|PPC
Influencer Marketing
Brand Strategy|Brand Communication|Marketing Communications|Corporate Communications
Event Management|Event Planning
Monitoring and Evaluation|M&E|MEAL
Grant Writing|Proposal Writing|Proposal Development|Fundraising
Project Cycle Management
Community Development|Community Mobilization|Community Engagement
Needs Assessment
Program Management|Programme Management|Programme Coordination
Donor Reporting|Donor Relations
Advocacy
Emergency Response|Disaster Management|Humanitarian
Capacity Building
Survey Design|Data Collection|Field Data Collection
KoBo|KoboToolbox|ODK
Employee Relations
Employee Engagement
Performance Management|Performance Appraisal
Onboarding|Employee Onboarding
Talent Management|Succession Planning
Compensation and Benefits|C&B
HRIS
Office Administration|Office Management
Records Management|Record Keeping
Travel Coordination|Travel Management|Travel Booking
Visa Processing|Visa Services
Front Desk|Front Office|Reception
Appointment Scheduling|Calendar Management
Meeting Minutes|Minutes of Meeting|Minute Taking
Territory Management|Territory Sales
Distributor Management|Channel Management|Distribution Management
Trade Marketing|Visual Merchandising|Retail Merchandising
Sales Forecasting|Demand Planning|Forecasting
Pricing Strategy|Pricing
Retail Management|Store Management|Shop Management
Point of Sale|POS
After Sales Service|Aftersales
Customer Retention
Customer Acquisition
Telesales|Telemarketing|Tele Sales
Field Sales
Product Knowledge
Housekeeping
Food Safety
Hospitality|Hospitality Management|Hotel Management
Driving License|Driving Licence
Physical Security|Security Management
Airport Operations|Ground Handling
#!soft
Communication Skills|Communication|Written Communication|Verbal Communication|Written and Verbal Communication|Interpersonal Communication|Business Communication
Teamwork|Team Player|Team Work|Collaboration
Problem Solving|Troubleshooting Skills
Analytical Skills|Analytical Thinking|Analytical Ability|Analytical Mindset
Critical Thinking
Time Management
Multitasking
Attention to Detail|Detail Oriented|Detail Orientation
Adaptability|Adaptable
Self Motivated|Self Starter|Proactive|Initiative
Fast Learner|Quick Learner|Eager to Learn|Willingness to Learn|Learning Agility|Passion for Learning
Interpersonal Skills|People Skills
Work Under Pressure|Deadline Driven|Meet Deadlines|Fast Paced Environment|Fast Paced
Creativity|Creative Thinking
Ownership|Accountability
Organizational Skills|Organisational Skills
Presentation Skills|Presentations|Public Speaking
Report Writing|Business Writing|Technical Writing
Research Skills
English Proficiency|Fluent English|Good English|English Language|English Communication|Command of English|Command in English|Proficiency in English
Bangla
Emotional Intelligence
Conflict Resolution
Mentoring|Coaching
#!degree
Bachelor's Degree|Bachelor Degree|Bachelor of Science|Bachelor|BSc|B.Sc|Undergraduate Degree|Graduation
Master's Degree|Masters|MSc|M.Sc|Master of Science|Postgraduate
MBA|Master of Business Administration
BBA|Bachelor of Business Administration
Computer Science|Computer Science and Engineering|Computer Science & Engineering|CSE
Information Technology|Information and Communication Technology|ICT
Information Systems
Electrical and Electronic Engineering|EEE|Electrical Engineering
Business Administration|Business Studies
Finance
Economics
Mathematics
Diploma|Diploma in Engineering
SSC|Secondary School Certificate
HSC|Higher Secondary Certificate
Civil Engineering
Mechanical Engineering
Textile Engineering
Chemical Engineering
Pharmacy|Bachelor of Pharmacy|B.Pharm
LLB|LL.B|LL.B Degree|Bachelor of Laws|LLM
Mass Communication|Journalism
Public Administration
Agriculture
`;

// ---------------------------------------------------------------- matching

// Hyphens, dashes and underscores read as spaces and spaces around "/" vanish, so "Cross-Browser
// Testing", "cross browser testing" and "UI / UX" all compare equal.
function kwNorm(s){
 return String(s||"").replace(/[‘’]/g,"'").replace(/\s*\/\s*/g,"/").replace(/[\s\-‐-―_]+/g," ").trim();
}
const KW_EDGE="[A-Za-z0-9+#]";
function kwEscape(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}

// Whole-word match with an optional plural, so "test cases" finds "Test Case".
// Whole-word is what keeps "Java" out of "JavaScript" and "SQL" out of "MySQL".
function kwPhraseRegex(phrase,caseSensitive){
 const body=kwEscape(kwNorm(phrase));
 const plural=/[a-z]$/i.test(phrase)?"(?:s|es)?":"";
 return new RegExp("(?<!"+KW_EDGE+")"+body+plural+"(?!"+KW_EDGE+")",caseSensitive?"":"i");
}

const KW={entries:null,byKey:null};
function kwBuild(){
 if(KW.entries)return KW;
 KW.entries=[];KW.byKey=new Map();
 let kind="tech";
 for(const raw of KW_LEXICON.split("\n")){
  const line=raw.trim();
  if(!line)continue;
  if(line.startsWith("#!")){kind=line.slice(2).trim();continue;}
  if(line[0]==="#")continue;
  const aliases=line.split("|").map(a=>a.trim()).filter(Boolean).map(a=>{
   const cs=a[0]==="=",display=cs?a.slice(1):a;
   return {display,cs,low:kwNorm(display).toLowerCase(),re:kwPhraseRegex(display,cs),reAny:kwPhraseRegex(display,false)};
  });
  // Longest wording first, so the most specific alias in a line is the one reported.
  const name=aliases[0].display;
  aliases.sort((x,y)=>y.low.length-x.low.length);
  const entry={key:name.toLowerCase(),name,kind,aliases};
  KW.entries.push(entry);KW.byKey.set(entry.key,entry);
 }
 return KW;
}

// ---------------------------------------------------------------- reading the post

const KW_HEADINGS=[
 ["preferred",/\b(prefer(?:red|ably)?|nice to have|good to have|bonus|desirable|advantage|plus points?|added advantage)\b/i],
 ["ignore",/\b(about (?:us|the (?:company|organi[sz]ation|opportunity)|our (?:company|team))|who we are|our (?:story|culture|values|mission)|life at|company (?:overview|profile|description)|benefits?|perks|compensation|what we offer|why join|how to apply|to apply|equal opportunity|contact|application (?:deadline|process|procedure)|deadline)\b/i],
 ["required",/\b(requirements?|qualifications?|skills?|competenc(?:y|ies)|must[- ]haves?|what you(?:'ll| will)? (?:need|bring)|looking for|who you are|about you|your profile|eligibility|education(?:al)?|experience|technical|expertise|proficienc(?:y|ies))\b/i],
 ["duties",/\b(responsibilit(?:y|ies)|duties|what you(?:'ll| will)?(?: be)? (?:do|doing)|role|key tasks|job (?:description|summary|highlights|context)|summary|scope|day to day|activities|overview|highlights|opportunity)\b/i]
];
// "Location: Dhaka", "Salary: Negotiable" and the like carry no skills.
const KW_LABEL_SKIP=/^(location|employment(?: type| status)?|vacanc(?:y|ies)|no\.? of vacanc\w+|salary|deadline|application deadline|age|gender|department|job nature|job type|headquarters|url|category|posted|published|apply(?: before| by)?|workplace|working (?:days|hours))$/i;
const KW_CUE_PREF=/\b(prefer(?:red|ably)?|nice to have|good to have|a plus|plus point|bonus|advantage|desirable|optional|an asset|not mandatory)\b/i;
const KW_CUE_REQ=/\b(must|required|requirement|mandatory|essential|minimum|need(?:s|ed)? to|should have|proficien(?:t|cy)|strong (?:knowledge|understanding|experience|command|background)|hands[- ]on|expert(?:ise)?|solid (?:knowledge|understanding|experience))\b/i;

function kwSegments(text){
 const out=[];
 for(const line of String(text||"").replace(/\r/g,"").replace(/[‘’]/g,"'").split("\n")){
  for(let part of line.split(/\s*[•▪◦●·]\s*/)){
   part=part.replace(/^[\s*\-–—]+/,"").trim();
   if(!part)continue;
   if(part.length>180){
    for(const s of part.split(/(?<=[.!?;])\s+(?=[A-Z0-9(])/)){if(s.trim())out.push(s.trim());}
   }else out.push(part);
  }
 }
 return out;
}

function kwSectionType(label){
 for(const [type,re] of KW_HEADINGS)if(re.test(label))return type;
 return null;
}

// A heading is a short title-case line ("Key Responsibilities") or a "Label: rest" line. A short line
// that holds a known skill ("Good communication skills") is a bullet, not a heading.
function kwHeading(seg,hasSkill){
 const colon=/^([^:]{2,60}?):\s*(.*)$/.exec(seg);
 if(colon){
  const label=colon[1].trim();
  if(KW_LABEL_SKIP.test(label))return {skip:true};
  const type=kwSectionType(label);
  return type?{type,rest:colon[2].trim(),inline:!!colon[2].trim()}:null;
 }
 const t=seg.replace(/[\s:]+$/,"");
 const words=t.split(/\s+/);
 if(!hasSkill&&words.length<=6&&KW_HEADING_PHRASE.test(t)){
  const type=/^(?:how we work|why )/i.test(t)?"ignore":kwSectionType(t);
  return type?{type,rest:""}:null;
 }
 if(hasSkill||words.length>5||t.length>48||/[.!?,;]$/.test(t))return null;
 if(!words.every(w=>/^[A-Z&(]/.test(w)||/^(?:of|and|the|for|to|in|a|an|or)$/.test(w)))return null;
 if(/^About\s/.test(t)&&!/^About (?:you|the (?:role|job|position)|this (?:role|job|position))$/i.test(t))return {type:"ignore",rest:""};
 const type=kwSectionType(t);
 return type?{type,rest:""}:null;
}

function kwHits(seg,entries){
 const norm=kwNorm(seg),low=norm.toLowerCase(),hits=[];
 for(const e of entries){
  for(const a of e.aliases){
   if(!low.includes(a.low))continue;
   if(a.re.test(norm)){hits.push({entry:e,alias:a});break;}
  }
 }
 return hits;
}

function kwRank(t){return t==="must"?0:t==="important"?1:2}
function kwRecord(map,key,proto,display,weight,tier,inTitle){
 let r=map.get(key);
 if(!r){r={...proto,key,display,count:0,score:0,tier:"nice",inTitle:false,order:map.size};map.set(key,r);}
 r.count++;
 if(r.count<=3)r.score+=weight;
 if(kwRank(tier)<kwRank(r.tier))r.tier=tier;
 if(inTitle){if(!r.inTitle){r.score+=3;r.inTitle=true;}r.tier="must";}
 if(proto.source==="lexicon"&&display.length>r.display.length)r.display=display;
 return r;
}

// ---------------------------------------------------------------- terms from the post itself
//
// The lexicon knows common skills, but every field has terms no list will ever hold (calibration,
// dispute resolution, wound care, checkweighers...). So the rest is read from the post: runs of
// meaningful words between stop words and punctuation, kept only when the post signals they matter.
// Nothing here depends on the candidate's field, or on the job's.

const KW_LEAD=/^(?:(?:strong|good|solid|excellent|basic|working|hands[- ]on|proven|demonstrated|in[- ]depth|thorough|sound|advanced|practical|prior|relevant|deep|fluent|proficient|extensive|previous)\s+)*(?:knowledge|understanding|experience|proficiency|expertise|skills?|familiarity|command|background|exposure|competenc(?:y|ies)|ability|capabilit(?:y|ies))\s+(?:of|in|with|on|using|around)\s+(?:(?:the|a|an|any|using)\s+)?/i;
const KW_ACR_STOP=new Set("USA UK UAE BD BDT TK CV PDF MD AM PM ASAP FAQ PLC LTD LLC INC CEO CFO CTO COO HQ NYSE ARR YOY EMEA APAC US EU ID OK NO YES II III IV SR JR EEO CGPA GPA NID HR OR AND THE FOR NOT ALL ANY BSC MSC PHD SSC HSC MT MTO GM AGM DGM VP SVP EVP CA&C P&C".split(" "));
// Legal boilerplate ("recruiting, hiring, placement...") is not a list of skills.
const KW_EEO=/equal (?:employment )?opportunity|non-?discriminat|without regard to|protected (?:class|status|veteran)|affirmative action|reasonable accommodations?/i;
// Whole-line headings written as sentences ("What you'll need"), which the title-case rule misses.
const KW_HEADING_PHRASE=/^(?:what (?:you(?:'ll| will)?(?: be)? (?:need|bring|do|doing)|we(?:'re| are) looking for)|who you are|about you|your (?:profile|background|skills)|(?:the )?(?:role|job|position)|(?:nice|good) to have|bonus points?|must[- ]haves?|responsibilities|requirements|qualifications|key skills|how we work|why (?:join|work)\b.*)\??$/i;
// A short line with no closing punctuation reads as a heading, even one we do not recognise.
const KW_HEADINGISH=/^[A-Z][^.!?,;:]{0,58}$/;

// Words that never make a keyword on their own: grammar, and the vocabulary every job post shares.
const KW_STOP=new Set((`
a an the and or but nor so yet for of in on at to from by with without within into onto over under about above below
between among through during before after as than then that this these those it its they them their we our us you
your he she his her i me my who whom whose which what when where why how all any each every both either neither some
such no not only own same other another more most less least few many much several various also just very too can
could may might must shall should will would do does did done doing be am is are was were been being have has had
having get gets got getting make makes made making let up down out off again further once here there while if
because until against per via etc ie eg vs plus
candidate candidates applicant applicants job jobs role roles position positions responsibility responsibilities
duty duties requirement requirements qualification qualifications skill skills ability abilities able knowledge
experience experiences experienced year years month months minimum maximum preferred preferably desirable required
advantage strong good excellent great solid proven demonstrated relevant related similar equivalent including
include includes included well working work works worked team teams member members company companies organization
organisation department office environment opportunity opportunities benefit benefits salary compensation package
apply applying application applications submit send email resume cv contact address deadline joining join looking
seeking hiring hire new high higher highly effective efficient efficiently successful successfully willing eager
passionate motivated dynamic growing leading leader based across general specific overall main major key necessary
appropriate proper properly regular regularly timely accurate accurately detailed various day daily weekly monthly
annual full part time fulltime parttime available availability level levels ensure ensures ensuring provide
provides providing perform performs performing prepare prepares preparing maintain maintains maintaining manage
manages managing develop develops developing support supports supporting assist assists assisting conduct
conducts conducting coordinate coordinates coordinating review reviews reviewing identify identifies identifying
participate participates participating collaborate collaborates collaborating monitor monitors monitoring handle
handles handling create creates creating implement implements implementing execute executes executing deliver
delivers delivering follow follows following report reports submit submits lead leads leading drive drives driving
oversee oversees overseeing advise advises advising communicate communicates communicating attend attends
contribute contributes contributing achieve achieves achieving understand understands understanding use uses
using used utilize utilizes need needs needed want wants find finds ability like likes take takes taking keep keeps
help helps helping build builds building set sets setting run runs running act acts acting place places placed
give gives giving ensure related regarding respect respective concerned relevant under upon per one two three four
five six seven eight nine ten first second third also however therefore thus hence today
male female both gender age aged nationality bangladeshi vacancy vacancies negotiable taka bdt tk hrs hour hours
shift shifts limited ltd plc inc corp llc pvt co
culture values mission vision spirit people person individuals individual professional professionals
ats friendly additional information designation location reputed university universities institution institute
public private remuneration allowance allowances bonus bonuses festival appraisal mindset positive negotiable
industry industries sector sectors familiarity capability capabilities commitment integrity confidentiality
manager managers executive executives officer officers assistant director directors head supervisor supervisors
senior junior sr jr deputy associate enhance enhancing improve improving increase increasing
operations operational performance coordination presentation planning management reporting training regulations
regulation employment procedures procedure departments department production engineering manufacturing selling
territory execution implementation messaging factory factories process processes system systems
relationship relationships relation relations education software certification certifications confirmation
orientation productivity agility promotions telecommunication distribution technology technologies usd
considered favourably favorably
writing development testing design analysis building reading speaking
`).split(/\s+/).filter(Boolean));
// Places and the like: never skills.
const KW_PLACES=new Set("dhaka dhanmondi gulshan banani uttara mirpur mohakhali motijheel tejgaon badda gazipur narayanganj savar chattogram chittagong khulna rajshahi sylhet barishal barisal rangpur mymensingh comilla cumilla bogura bogra jashore jessore cox bazar bangladesh mirsarai nsez beza epz asia europe america africa london singapore malaysia india pakistan usa".split(" "));

function kwCased(s){return s.split(" ").map(w=>/^[A-Z0-9&+]+$/.test(w)||w.length<3?w:w[0].toUpperCase()+w.slice(1)).join(" ")}

// A phrase and its plural are one keyword.
function kwStem(phrase){return phrase.replace(/ies$/,"y").replace(/([^s])s$/,"$1")}
function kwTrimWord(w){return w.replace(/^[^A-Za-z0-9+#]+|[^A-Za-z0-9+#]+$/g,"").replace(/'s$/i,"")}
function kwIsAcronym(w){return /^[A-Z][A-Z0-9&+]{1,6}$/.test(w)&&!KW_ACR_STOP.has(w)}
function kwInnerCaps(w){return /^[a-z]+[A-Z]/.test(w)||/^[A-Z][a-z]+[A-Z]/.test(w)}
// A lone word only counts when it looks like a thing rather than a quality: "calibration", not "commercial".
function kwNounish(w){return w.length>=6&&/(tion|sion|ment|ance|ence|ity|ing|ship|ology|ics|ism|ure|age|ery|ory|ist|ware)s?$/i.test(w)}

const KW_BREAK=/[,;:()\[\]{}"|!?•–—\/]|\s[&+]\s|\.(?:\s|$)/;

// One run of meaningful words: remember it, and how the post used it.
function kwNote(run,ctx,gen,skip){
 if(run.length>4)return;
 const ws=run.map(r=>r.w),lo=ws.map(w=>w.toLowerCase());
 if(lo.some(w=>skip.has(w)))return;
 const one=ws.length===1;
 const shape=one?(kwIsAcronym(ws[0])||kwInnerCaps(ws[0])):(run.every(r=>/^[A-Z0-9]/.test(r.w))&&!(run[0].first&&run.length<2));
 if(one&&!(shape||kwNounish(ws[0])))return;
 const key="m:"+kwStem(lo.join(" "));
 let g=gen.get(key);
 if(!g){g={key,forms:new Map(),count:0,weights:[],tier:"nice",leadIn:false,shortReq:false,shape:false,words:ws.length,order:gen.size};gen.set(key,g);}
 g.count++;g.weights.push(ctx.weight);
 const shown=kwCased(ws.join(" "));
 g.forms.set(shown,(g.forms.get(shown)||0)+1);
 if(kwRank(ctx.tier)<kwRank(g.tier))g.tier=ctx.tier;
 g.leadIn=g.leadIn||ctx.leadIn;
 g.shortReq=g.shortReq||(ctx.short&&ctx.tier!=="important");
 g.shape=g.shape||shape;
}

function kwCollect(seg,hits,tier,weight,gen,skip){
 // Terms the lexicon already found are blanked first, so nothing is counted twice and "CI/CD" or
 // "MS Excel" do not leave "CI", "CD" and "MS" behind.
 // Every spelling of a found term is blanked, not just the longest: "Bachelor of Business Administration
 // (BBA)" must not leave "BBA" behind.
 let text=kwNorm(seg);
 for(const h of hits)for(const a of h.entry.aliases){
  if(!a.reG)a.reG=new RegExp(a.re.source,a.re.flags+"g");
  text=text.replace(a.reG," | ");
 }
 // short: a bullet that is itself the term ("Structural analysis"), not a sentence with a verb in it
 const ctx={tier,weight,leadIn:KW_LEAD.test(seg),short:seg.split(/\s+/).length<=4&&!/^(?:the|our|we|you|your|it|they|this|that|these|those|he|she|there|as|if|when|while|for|i)\b/i.test(seg)};
 let first=true;
 for(const part of text.split(KW_BREAK)){
  let run=[];
  const flush=()=>{if(run.length)kwNote(run,ctx,gen,skip);run=[];};
  for(const raw of part.split(/\s+/)){
   const w=kwTrimWord(raw);
   if(!w)continue;
   const bad=w.length<2||KW_STOP.has(w.toLowerCase())||/^\d+$/.test(w)||(/^\d/.test(w)&&!/^\d+[A-Za-z]{1,3}$/.test(w));
   if(bad){flush();first=false;continue;}
   run.push({w,first});
   first=false;
  }
  flush();
 }
}

// Keep a run only when the post signals that it matters.
function kwAccept(g){
 // A lone ordinary word ("calibration", "storytelling") proves nothing by repeating; it needs the post to
 // point at it: "experience with X", or a short requirement line.
 if(g.words===1&&!g.shape)return g.leadIn||g.shortReq;
 if(g.count>=2)return true;                       // a phrase, an acronym or a named tool said more than once
 return g.leadIn||g.shortReq;                     // "experience with X", or a short requirement line
}

function kwGeneral(gen,limit){
 const accepted=[...gen.values()].filter(kwAccept).sort((a,b)=>b.words-a.words);
 const kept=[];
 for(const g of accepted){
  const inner=" "+g.key.slice(2)+" ";
  // "maintenance" is dropped when "preventive maintenance" was said just as often.
  if(kept.some(o=>o.words>g.words&&(" "+o.key.slice(2)+" ").includes(inner)&&o.count>=g.count))continue;
  kept.push(g);
 }
 return kept.map(g=>{
  const shown=[...g.forms.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  const score=[...g.weights].sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0)+(g.words>=2?1:0)+(g.shape?1:0);
  return {key:g.key,name:shown,display:shown,kind:"tech",source:"mined",count:g.count,score,tier:g.tier,inTitle:false,order:g.order};
 }).sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,limit);
}

// ---------------------------------------------------------------- the main entry point

// text: the post. title: the job title (a keyword in it is a must-have). company: skipped as a keyword.
function extractKeywords(text,title,company){
 const {entries}=kwBuild();
 const map=new Map();
 const gen=new Map();
 const skip=new Set(KW_PLACES);
 for(const w of String(company||"").toLowerCase().split(/[^a-z0-9]+/))if(w.length>=3)skip.add(w);
 const lexProto=e=>({name:e.name,kind:e.kind,source:"lexicon"});

 for(const h of kwHits(title||"",entries))kwRecord(map,h.entry.key,lexProto(h.entry),h.alias.display,3,"must",true);

 let section="other";
 for(const raw of kwSegments(String(text||"").slice(0,60000))){
  let seg=raw,hits=kwHits(seg,entries),sec=section;
  if(KW_EEO.test(seg)){section="ignore";continue;}
  const h=kwHeading(seg,hits.length>0);
  if(h){
   if(h.skip)continue;
   seg=h.rest;
   if(h.inline)sec=h.type;             // "Skills: PHP, SQL" governs that line only
   else{section=sec=h.type;}
   if(!seg)continue;
   hits=kwHits(seg,entries);
  }else if(section==="ignore"&&hits.length===0&&KW_HEADINGISH.test(seg)&&seg.split(/\s+/).length<=6){
   section="other";continue;           // "How we work": the company blurb is over
  }
  if(sec==="ignore")continue;
  const pref=KW_CUE_PREF.test(seg),req=KW_CUE_REQ.test(seg);
  const tier=pref||sec==="preferred"?"nice":(req||sec==="required")?"must":"important";
  const weight=tier==="must"?3:tier==="nice"?1:(sec==="duties"?2:1);
  for(const hit of hits)kwRecord(map,hit.entry.key,lexProto(hit.entry),hit.alias.display,weight,tier,false);
  kwCollect(seg,hits,tier,weight,gen,skip);
 }

 // At most 14 terms from the post itself, best first; the lexicon's are all kept.
 for(const g of kwGeneral(gen,14))map.set(g.key,g);
 return [...map.values()]
  .sort((x,y)=>y.score-x.score||kwRank(x.tier)-kwRank(y.tier)||x.order-y.order)
  .map(({order,...k})=>k);
}

// ---------------------------------------------------------------- against the candidate's profile

// Everything the candidate has actually written about themselves. This is the only thing that can
// make a keyword count as "yours".
//
// Two grades of evidence, because a word appearing in a sentence is weaker than a skill you list:
//   skills  what the candidate lists as a skill or degree, a project's tech, or a job title held
//   prose   only mentioned inside experience or project sentences, or an experience tag
// "verifying backend behaviour through frontend actions" is QA work; it does not make someone a
// backend developer, so prose matches are offered to the candidate rather than added.
function keywordEvidence(p){
 return {
  skills:[
   ...(p.skills||[]).flatMap(g=>g.items||[]),
   ...(p.education||[]).flatMap(e=>[e.degree,e.institution]),
   ...(p.experience||[]).map(x=>x.role),
   ...(p.projects||[]).flatMap(x=>[x.name,x.subtitle||"",...(x.skills||[])])
  ].filter(Boolean).join(" \n "),
  prose:[
   ...(p.experience||[]).flatMap(x=>[x.company,...(x.bullets||[]),...(x.tags||[])]),
   ...(p.projects||[]).flatMap(x=>x.bullets||[])
  ].filter(Boolean).join(" \n ")
 };
}

function kwFoundIn(k,text){return kwFoundNorm(k,kwNorm(text))}
function kwFoundNorm(k,t){
 if(k.source==="lexicon"){
  const e=kwBuild().byKey.get(k.key);
  return !!e&&e.aliases.some(a=>a.reAny.test(t));
 }
 return kwPhraseRegex(k.name,false).test(t);
}

// evidence: the object keywordEvidence returns (a plain string counts as skills).
// Sets k.evidence ("skills" | "prose" | "none") and k.have (true unless "none").
function annotateKeywords(kws,evidence){
 const ev=typeof evidence==="string"?{skills:evidence,prose:""}:(evidence||{skills:"",prose:""});
 const s=kwNorm(ev.skills),pr=kwNorm(ev.prose);
 return kws.map(k=>{
  const grade=kwFoundNorm(k,s)?"skills":kwFoundNorm(k,pr)?"prose":"none";
  return {...k,evidence:grade,have:grade!=="none"};
 });
}

// The candidate decides. Every keyword starts undecided and is on the resume only after they press
// Add for it; Not add keeps it off. `evidence` (skills / prose / none) is shown beside each keyword so the
// choice is informed, but it never decides for them. Degrees are shown and never added: the Education
// section already carries them, and no keyword line can supply one.
function pickForResume(kws,decisions){
 const added=new Set((decisions&&decisions.added)||[]);
 return kws.filter(k=>k.kind!=="degree"&&added.has(k.key));
}

// A job's saved keyword choices. Older saves used `claimed` (added by hand) and `off` (left out of an
// automatic list); the automatic list is gone, so `claimed` carries over as added and `off` as not added.
function normalizeDecisions(saved){
 const s=saved||{};
 const list=v=>Array.isArray(v)?[...new Set(v.filter(x=>typeof x==="string"))]:[];
 const added=list(s.added!==undefined?s.added:s.claimed);
 const skipped=list(s.skipped!==undefined?s.skipped:s.off).filter(k=>!added.includes(k));
 return {enabled:s.enabled!==false,added,skipped};
}

// How many of the post's keywords a piece of text contains, overall and among the must-haves.
// This is deliberately strict: a keyword counts only when the text uses the post's own wording,
// because that is how a simple ATS filter searches ("Test Cases" does not find "Test Case Design").
// Degrees are left out: the Education section shows them and no keyword line can supply one.
function keywordCoverage(kws,text){
 const t=kwNorm(text);
 const list=kws.filter(k=>k.kind!=="degree");
 const found=list.filter(k=>kwPhraseRegex(k.display,false).test(t));
 const must=list.filter(k=>k.tier==="must");
 return {
  found:found.length,total:list.length,
  mustFound:must.filter(k=>found.includes(k)).length,mustTotal:must.length,
  missing:list.filter(k=>!found.includes(k)).map(k=>k.display)
 };
}

// How many keywords a piece of text (a resume bullet, say) contains, for ranking bullets and projects.
function keywordHits(text,kws){
 const t=kwNorm(text);
 return kws.reduce((n,k)=>n+(kwFoundNorm(k,t)?1:0),0);
}
