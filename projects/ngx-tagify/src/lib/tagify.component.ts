import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter, forwardRef,
  Input,
  OnDestroy,
  Output,
  ViewChild
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { asyncScheduler, BehaviorSubject, fromEvent, merge, Observable, Subject } from 'rxjs';
import { takeUntil, throttleTime } from 'rxjs/operators';
import Tagify, { TagData, TagifySettings } from '@yaireo/tagify';
import { TagifyService } from './tagify.service';

@Component({
  selector: 'tagify',
  template: `<input [ngClass]="inputClassValue" #inputRef/>`,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => TagifyComponent),
    multi: true
  }]
})
export class TagifyComponent implements AfterViewInit, ControlValueAccessor, OnDestroy {

  private valueData: TagData[];
  private onChange: any = Function.prototype;
  private onTouched: any = Function.prototype;

  private unsubscribe$ = new Subject<void>();
  private value$ = new BehaviorSubject<TagData[]>(null);
  private tagify: Tagify;

  inputClassValue = '';
  readonlyValue = false;

  @ViewChild('inputRef', {static: true}) inputRef: ElementRef<HTMLInputElement>;

  @Input() settings: TagifySettings = {};
  @Input() name = '';
  @Input() whitelist: Observable<string[]|TagData[]>;
  @Input() set inputClass(v: string) {
    this.setTagsClass(v);
    this.inputClassValue = v;
  }
  @Input() set readonly(v: boolean) {
    this.readonlyValue = !!v;
    this.setReadonly();
  }

  get value(): TagData[] {
    return this.valueData;
  }

  set value(v: TagData[]) {
    if (v !== this.valueData) {
      this.valueData = v;
      this.onChange(v);
    }
  }

  @Output() add = new EventEmitter();
  @Output() remove = new EventEmitter();
  @Output() tInput = new EventEmitter<string>();

  constructor(
    private tagifyService: TagifyService,
    private element: ElementRef<HTMLElement>
  ) { }

  ngAfterViewInit(): void {
    this.settings.callbacks = this.settings.callbacks || {};

    if (!this.settings.callbacks.hasOwnProperty('add')) {
      this.settings.callbacks.add = () => this.add.emit({
        tags: this.tagify.value,
        added: this.tagify.value[this.tagify.value.length - 1]
      });
    }

    if (!this.settings.callbacks.hasOwnProperty('remove')) {
      this.settings.callbacks.remove = () => this.remove.emit(this.tagify.value);
    }

    this.tagify = new Tagify(this.inputRef.nativeElement, this.settings);

    // add to service if name is provided
    if (this.name.length) {
      this.tagifyService.add(this.name, this.tagify);
    }

    this.setReadonly();

    // listen to value changes from outside
    this.value$
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe(tags => {

        if (!tags) { return; }

        // add all tags (already existing tags will be skipped
        this.tagify.addTags(tags, false, true);

        // remove all tags that are not part of value anymore
        this.tagify.value.forEach(v => {
          if (!tags.find(t => t.value === v.value)) {
            // somehow removeTags() with string parameter doesn't always find the tag element
            // this is a workaround for finding the right tag element
            const tagElm = this.tagify.getTagElms().find(el => el.attributes.getNamedItem('value').textContent === v.value);
            this.tagify.removeTags(tagElm);
          }
        });

      });

    // listen to tagify events
    this.tagify.on('input', e => {
      this.tInput.emit(e.detail.value);
    });

    merge(
      // @ts-ignore
      fromEvent(this.tagify, 'add'),
      // @ts-ignore
      fromEvent(this.tagify, 'remove')
    )
      .pipe(
        // throttle used to reduce number of value changes when adding/removing a bunch of tags
        throttleTime(0, asyncScheduler, { leading: false, trailing: true }),
        takeUntil(this.unsubscribe$)
      )
      .subscribe(() => {
        this.value = this.tagify.value.slice();
      });

    // listen to suggestions updates
    if (this.whitelist) {
      this.whitelist
        .pipe(takeUntil(this.unsubscribe$))
        .subscribe(list => {
          this.tagify.settings.whitelist = list;
        });
    }
  }

  writeValue(tags: TagData[]) {
    this.value$.next(tags);
  }

  registerOnChange(fn: any) {
    this.onChange = fn;
  }

  registerOnTouched(fn: any) {
    this.onTouched = fn;
  }

  /**
   * Tagify creates a `tags` element to which the classes of the `input` element are applied.
   * Changes of `inputClass` are applied automatically to the `input` element, but have to be
   * manually applied to the `tags` element.
   */
  private setTagsClass(v: string): void {
    const tagsElement = this.element.nativeElement.querySelector('tags');
    if (tagsElement) {
      tagsElement.classList.remove(...this.inputClassValue.split(/\s+/));
      tagsElement.classList.add(...v.split(/\s+/));
    }
  }

  private setReadonly() {
    if (this.tagify) {
      this.tagify.setReadonly(this.readonlyValue);
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();

    this.tagify.destroy();

    if (this.name.length) {
      this.tagifyService.remove(this.name);
    }
  }

}
